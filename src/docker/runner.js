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
import { dirname, basename, join as pathJoin } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { mkdtemp, copyFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));

/** Default auth directory paths on the host (WSL) */
const AUTH_DIRS = {
  gemini: `${homedir()}/.gemini`,
  'claude-code': `${homedir()}/.claude`,
  codex: `${homedir()}/.codex`,
};

/** Auth mount target inside the container */
const AUTH_MOUNTS = {
  gemini: '/home/node/.gemini',
  'claude-code': '/home/node/.claude',
  codex: '/home/node/.codex',
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
   * @param {string} [options.stateDir]
   */
  constructor(options = {}) {
    this.defaultMemory = options.defaultMemory ?? '2g';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.stateDir = options.stateDir ?? pathJoin(homedir(), '.local', 'share', 'multi-agent-orchestrator-v3');
    this.logDir = pathJoin(this.stateDir, 'logs');
  }

  /**
   * Create an isolated Gemini auth directory for a single container run.
   * Copies only credentials — deliberately excludes session history (tmp/, history/)
   * so each worker starts with a clean context and sessions never accumulate.
   *
   * @param {string} sourceDir  - host ~/.gemini
   * @returns {Promise<string>} - path to the temp dir (caller must rm -rf after use)
   */
  async _isolatedGeminiAuth(sourceDir) {
    const tempDir = await mkdtemp(pathJoin(tmpdir(), 'gemini-auth-'));
    // Files needed for authentication and Gemini CLI startup
    const credFiles = ['oauth_creds.json', 'google_accounts.json', 'user_id', 'installation_id', 'state.json'];
    for (const f of credFiles) {
      const src = pathJoin(sourceDir, f);
      if (existsSync(src)) {
        await copyFile(src, pathJoin(tempDir, f));
      }
    }
    // Worker settings override (no MCP servers, no host-specific config)
    const workerSettings = WORKER_SETTINGS_HOST.gemini;
    if (workerSettings && existsSync(workerSettings)) {
      await copyFile(workerSettings, pathJoin(tempDir, 'settings.json'));
    }
    return tempDir;
  }

  /**
   * Spawn a worker container to execute a task.
   *
 * @param {Object} params
 * @param {string} params.taskId
 * @param {string} params.agentName       - 'gemini' | 'claude-code' | 'codex'
 * @param {string} params.worktreePath    - host path to the git worktree
 * @param {string[]} params.cliArgs       - args to pass to the CLI inside the container
 * @param {string} [params.jobId]         - optional job UUID to prefix the container name
 * @param {Object} [params.options]
 * @param {number} [params.options.timeoutMs]
 * @param {string} [params.options.memory]
 * @param {string} [params.options.image]  - override image name
 * @param {Object} [params.options.auth]   - override auth mount config from agent settings
   *
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string, duration_ms: number, containerId: string}>}
   */
  async run({ taskId, agentName, worktreePath, cliArgs, jobId, options = {} }) {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const memory = options.memory ?? this.defaultMemory;
    const image = options.image ?? `worker-${agentName}:latest`;
    const jobIdStr = jobId ? `${jobId}-` : '';
    const containerName = `worker-${agentName}-${jobIdStr}${taskId}`;
    const timeoutSec = Math.ceil(timeoutMs / 1000);

    const authCfg = options.auth ?? {};
    const sourceAuthDir = this._resolveAuthPath(authCfg.mountFrom ?? AUTH_DIRS[agentName]);
    const authMount = authCfg.mountTo ?? AUTH_MOUNTS[agentName];
    const authMode = authCfg.mode ?? (agentName === 'gemini' ? 'rw' : 'ro');

    // Ensure log directory exists
    if (!existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true });
    }
    const logFilePath = pathJoin(this.logDir, `${taskId}.log`);
    const logStream = createWriteStream(logFilePath, { flags: 'a' });

    // For Gemini: create a per-task isolated auth dir (credentials only, no session history).
    // This prevents cached sessions from previous tasks leaking into the new worker context.
    // For Claude: mount the host auth dir read-only as before.
    let tempAuthDir = null;
    const effectiveAuthDir = agentName === 'gemini' && sourceAuthDir && existsSync(sourceAuthDir)
      ? (tempAuthDir = await this._isolatedGeminiAuth(sourceAuthDir), tempAuthDir)
      : sourceAuthDir;

    const dockerArgs = [
      'run',
      '--rm',
      '--name', containerName,
      '-v', `${worktreePath}:/work`,
      '--memory', memory,
      '--stop-timeout', String(timeoutSec),
    ];

    if (effectiveAuthDir && authMount && existsSync(effectiveAuthDir)) {
      dockerArgs.push('-v', `${effectiveAuthDir}:${authMount}:${authMode}`);

      // Claude still needs the settings.json override (no isolated dir for it)
      if (agentName !== 'gemini') {
        const workerSettings = WORKER_SETTINGS_HOST[agentName];
        if (workerSettings) {
          dockerArgs.push('-v', `${workerSettings}:${authMount}/settings.json:ro`);
        }
      }
    }

    // Mount the project .git directory and set git env vars so git works inside
    // the container without needing to read the /work/.git pointer file.
    // The .git file contains a HOST path (/mnt/d/...) invisible inside the container;
    // these env vars bypass it entirely.
    const projectRoot = dirname(dirname(worktreePath)); // .worktrees/<name> -> project root
    const worktreeName = basename(worktreePath);        // e.g. gemini-T1
    dockerArgs.push('-v', `${projectRoot}/.git:/project-git:rw`);
    dockerArgs.push('-e', `GIT_DIR=/project-git/worktrees/${worktreeName}`);
    dockerArgs.push('-e', `GIT_COMMON_DIR=/project-git`);
    dockerArgs.push('-e', `GIT_WORK_TREE=/work`);

    // Extra bind-mounts (e.g. stub files injected over git-tracked paths)
    for (const mount of (options.extraMounts ?? [])) {
      dockerArgs.push('-v', mount);
    }

    dockerArgs.push(image, ...cliArgs);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutHandle = null;

    logStream.write(`\n--- [${new Date().toISOString()}] Starting container: ${containerName} ---\n`);
    logStream.write(`Command: docker ${dockerArgs.join(' ')}\n\n`);

    return new Promise((resolve, reject) => {
      const cp = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      cp.stdout.on('data', (chunk) => {
        stdout += chunk;
        logStream.write(chunk);
      });
      cp.stderr.on('data', (chunk) => {
        stderr += chunk;
        logStream.write(chunk);
      });

      const settle = (err) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        logStream.end();
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

      cp.on('exit', async (code) => {
        const duration_ms = Date.now() - startTime;
        logStream.write(`\n--- [${new Date().toISOString()}] Container exited with code ${code} after ${duration_ms}ms ---\n`);
        settle(null);
        // Clean up the per-task isolated auth dir (Gemini only)
        if (tempAuthDir) rm(tempAuthDir, { recursive: true, force: true }).catch(() => {});
        resolve({ exitCode: code ?? 1, stdout, stderr, duration_ms, containerId: containerName });
      });

      cp.on('error', (err) => {
        logStream.write(`\n--- [${new Date().toISOString()}] Process error: ${err.message} ---\n`);
        settle(err);
      });
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

  _resolveAuthPath(authPath) {
    if (!authPath || typeof authPath !== 'string') return null;
    if (authPath === '~') return homedir();
    if (authPath.startsWith('~/')) return pathJoin(homedir(), authPath.slice(2));
    return authPath;
  }
}
