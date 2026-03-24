/**
 * Platform detection constants.
 *
 * Import from here rather than calling platform() in each file.
 * This gives us a single place to mock in tests if needed.
 */
import { platform } from 'node:os';
import { spawn } from 'node:child_process';

const _platform = platform();

export const IS_WINDOWS = _platform === 'win32';
export const IS_LINUX   = _platform === 'linux';
export const IS_MAC     = _platform === 'darwin';

/**
 * On Windows, npm CLIs are installed as .cmd wrappers (e.g. claude.cmd, gemini.cmd).
 * execFile cannot spawn .cmd files directly — must route through cmd.exe /c.
 *
 * On Linux/Mac, CLIs are plain executables in PATH — spawn directly.
 *
 * @param {Function} execFileAsync - promisified execFile
 * @param {string} command
 * @param {string[]} args
 * @param {Object} options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function platformExec(execFileAsync, command, args, options) {
  if (IS_WINDOWS) {
    return execFileAsync('cmd.exe', ['/c', command, ...args], options);
  }
  return execFileAsync(command, args, options);
}

/**
 * Spawn a process, collect stdout/stderr, and resolve on the process EXIT event
 * (not the 'close' event). This is critical when the spawned process itself exits
 * cleanly but leaves behind child processes (e.g. MCP servers) that keep the
 * stdio pipes open — which would cause promisified execFile to hang indefinitely
 * waiting for all file descriptors to close.
 *
 * On Windows, routes .cmd wrappers through cmd.exe /c (same as platformExec).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeout?: number, maxBuffer?: number, env?: Object }} options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function spawnCollect(command, args, options = {}) {
  const { cwd, timeout, maxBuffer = 10 * 1024 * 1024, env } = options;

  const [cmd, cmdArgs] = IS_WINDOWS
    ? ['cmd.exe', ['/c', command, ...args]]
    : [command, args];

  return new Promise((resolve, reject) => {
    const cp = spawn(cmd, cmdArgs, {
      cwd,
      env,
      stdio: 'pipe',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    cp.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (maxBuffer && stdout.length > maxBuffer) {
        settle(new Error('stdout maxBuffer exceeded'));
      }
    });

    cp.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = timeout
      ? setTimeout(() => {
          cp.kill('SIGTERM');
          settle(Object.assign(
            new Error(`Command timed out after ${timeout}ms`),
            { code: 'ETIMEDOUT', killed: true, stderr },
          ));
        }, timeout)
      : null;

    function settle(errOrNull) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (errOrNull) reject(errOrNull);
    }

    // Resolve on EXIT (not 'close') — the main process has finished.
    // Child processes that inherited our pipes (e.g. MCP servers) may still
    // be running, but we don't need to wait for them.
    cp.on('exit', (code) => {
      settle(null);
      resolve({ stdout, stderr });
    });

    cp.on('error', (err) => settle(err));
  });
}
