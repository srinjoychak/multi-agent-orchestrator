/**
 * Platform detection constants.
 *
 * Import from here rather than calling platform() in each file.
 * This gives us a single place to mock in tests if needed.
 */
import { platform } from 'node:os';

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
