/**
 * Docker Runner — manages the lifecycle of worker containers.
 *
 * Each worker agent runs in an ephemeral Docker container:
 *   docker run --rm -t --name worker-<agent>-<taskId> \
 *     -v <worktreePath>:/work \
 *     -v <authDir>:/home/node/.<agentDir> \
 *     --stop-timeout <timeoutSec> \
 *     --memory 2g \
 *     worker-<agent>:latest \
 *     <cliCommand> <cliArgs...>
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));

/** Default auth directory paths on the host (WSL) */
const AUTH_DIRS = {
  gemini: `${process.env.HOME}/.gemini`,
  'claude-code': `${process.env.HOME}/.claude`,
};

/** Auth mount target inside the container */
const AUTH_MOUNTS = {
  gemini: '/home/node/.gemini',
  'claude-code': '/home/node/.claude',
};

/**
 * Worker-safe settings files — mounted over the auth dir's settings.json
 * to prevent host MCP configs (with host-only paths) from breaking workers.
 */
const WORKER_SETTINGS_HOST = {
  gemini: pathJoin(__dir, '../../docker/workers/config/gemini-settings.json'),
};

export class DockerRunner {
  /**
   * @param {Object} [options]
   * @param {string} [options.defaultMemory='2g']
   * @param {number} [options.defaultTimeoutMs=120000]
   */
  constructor(options = {}) {
    this.defaultMemory = options.defaultMemory ?? '2g';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
  }

  /**
   * Spawn a worker container to execute a task.
   *
   * @param {Object} params
   * @param {string} params.taskId
   * @param {string} params.agentName       - 'gemini' | 'claude-code'
   * @param {string} params.worktreePath    - host path to the git worktree
   * @param {string[]} params.cliArgs       - args to pass to the CLI inside the container
   * @param {Object} [params.options]
   * @param {number} [params.options.timeoutMs]
   * @param {string} [params.options.memory]
   * @param {string} [params.options.image]  - override image name
   *
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string, duration_ms: number, containerId: string}>}
   */
  async run({ taskId, agentName, worktreePath, cliArgs, options = {} }) {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const memory = options.memory ?? this.defaultMemory;
    const image = options.image ?? `worker-${agentName}:latest`;
    const containerName = `worker-${agentName}-${taskId}`;
    const timeoutSec = Math.ceil(timeoutMs / 1000);

    const authDir = AUTH_DIRS[agentName];
    const authMount = AUTH_MOUNTS[agentName];

    const dockerArgs = [
      'run',
      '--rm',
      '-t',
      '--name', containerName,
      '-v', `${worktreePath}:/work`,
      '--memory', memory,
      '--stop-timeout', String(timeoutSec),
    ];

    if (authDir && authMount) {
      // Gemini needs rw (writes user_id, state), Claude can be ro
      const mode = agentName === 'gemini' ? 'rw' : 'ro';
      dockerArgs.push('-v', `${authDir}:${authMount}:${mode}`);

      // Override settings.json inside the container so workers don't inherit
      // host MCP server configs (host paths don't exist inside the container)
      const workerSettings = WORKER_SETTINGS_HOST[agentName];
      if (workerSettings) {
        dockerArgs.push('-v', `${workerSettings}:${authMount}/settings.json:ro`);
      }
    }

    dockerArgs.push(image, ...cliArgs);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutHandle = null;

    return new Promise((resolve, reject) => {
      const cp = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      cp.stdout.on('data', (chunk) => { stdout += chunk; });
      cp.stderr.on('data', (chunk) => { stderr += chunk; });

      const settle = (err) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (err) reject(err);
      };

      timeoutHandle = setTimeout(async () => {
        try {
          await execFileAsync('docker', ['stop', containerName]);
        } catch {
          await execFileAsync('docker', ['kill', containerName]).catch(() => {});
        }
        settle(Object.assign(
          new Error(`Container timed out after ${timeoutMs}ms`),
          { code: 'ETIMEDOUT', killed: true, stderr },
        ));
      }, timeoutMs);

      cp.on('exit', (code) => {
        settle(null);
        const duration_ms = Date.now() - startTime;
        resolve({ exitCode: code ?? 1, stdout, stderr, duration_ms, containerId: containerName });
      });

      cp.on('error', (err) => settle(err));
    });
  }

  /**
   * Get logs from a running or stopped container.
   * @param {string} containerId
   * @param {number} [tail=100]
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async logs(containerId, tail = 100) {
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'logs', '--tail', String(tail), containerId,
      ]);
      return { stdout, stderr };
    } catch (err) {
      return { stdout: '', stderr: err.message };
    }
  }

  /**
   * Force-stop a running container.
   * @param {string} containerId
   * @returns {Promise<boolean>}
   */
  async kill(containerId) {
    try {
      await execFileAsync('docker', ['stop', '--time', '5', containerId]);
      return true;
    } catch {
      try {
        await execFileAsync('docker', ['kill', containerId]);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Inspect a container's state.
   * @param {string} containerId
   * @returns {Promise<Object|null>}
   */
  async inspect(containerId) {
    try {
      const { stdout } = await execFileAsync('docker', ['inspect', containerId]);
      const data = JSON.parse(stdout);
      return data[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * List all running worker containers.
   * @returns {Promise<Array<{id: string, name: string, status: string, created: string}>>}
   */
  async listWorkers() {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps',
        '--filter', 'name=worker-',
        '--format', '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}',
      ]);
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [id, name, status, created] = line.split('\t');
        return { id, name, status, created };
      });
    } catch {
      return [];
    }
  }

  /**
   * Check if Docker is accessible.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await execFileAsync('docker', ['info'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
