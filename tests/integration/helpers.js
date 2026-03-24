import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

/**
 * Checks if a CLI command is available in the system PATH.
 * Returns true if available, false otherwise.
 * @param {string} name - CLI command name
 * @returns {Promise<boolean>}
 */
export async function isCliAvailable(name) {
  try {
    await execFileAsync(name, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Skip a test if a CLI is not available.
 * @param {string} name - CLI command name
 * @param {Object} testContext - node:test context
 */
export async function skipIfNoCli(name, testContext) {
  const available = await isCliAvailable(name);
  if (!available) {
    testContext.skip(`${name} CLI not found in PATH`);
  }
}

/**
 * Thin wrapper around execFileAsync for running CLI commands.
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function runCli(command, args, cwd) {
  return execFileAsync(command, args, { cwd, timeout: 60000 });
}

/**
 * Create a unique temporary directory and provide a cleanup function.
 * @returns {Promise<{path: string, cleanup: () => Promise<void>}>}
 */
export async function makeTmpDir() {
  const path = join(tmpdir(), `orchestrator-integration-${randomUUID()}`);
  await mkdir(path, { recursive: true });
  
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    }
  };
}
