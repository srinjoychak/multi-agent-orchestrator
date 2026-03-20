import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Base class for all agent adapters.
 * Each adapter wraps a specific CLI tool (Claude Code, Gemini, etc.)
 * and provides a uniform interface for the orchestrator.
 */
export class AgentAdapter {
  /**
   * @param {string} name - Agent identifier (e.g., "claude-code", "gemini")
   * @param {string} command - CLI command name (e.g., "claude", "gemini")
   * @param {Object} options
   * @param {number} [options.timeoutMs=300000] - Execution timeout (5 min default)
   */
  constructor(name, command, options = {}) {
    this.name = name;
    this.command = command;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this._process = null;
  }

  /**
   * Check if the CLI tool is installed and available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      // Try running with --version or --help to check existence
      const versionFlag = this.getVersionFlag();
      await this._execFile(this.command, [versionFlag], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the version/help flag for availability check.
   * Override in subclasses if the CLI uses a different flag.
   * @returns {string}
   */
  getVersionFlag() {
    return '--version';
  }

  /**
   * Build the CLI arguments for executing a task.
   * Must be implemented by subclasses.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string[]}
   */
  buildArgs(task, context) {
    throw new Error(`${this.name}: buildArgs() not implemented`);
  }

  /**
   * Parse the raw CLI output into a structured TaskResult.
   * Must be implemented by subclasses.
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} duration_ms
   * @returns {import('../types/index.js').TaskResult}
   */
  parseOutput(stdout, stderr, duration_ms) {
    throw new Error(`${this.name}: parseOutput() not implemented`);
  }

  /**
   * Internal wrapper for execFile to facilitate mocking in tests.
   * @param {string} command
   * @param {string[]} args
   * @param {Object} options
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async _execFile(command, args, options) {
    return execFileAsync(command, args, options);
  }

  /**
   * Execute a task using the CLI tool.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {Promise<import('../types/index.js').TaskResult>}
   */
  async execute(task, context) {
    const args = this.buildArgs(task, context);
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await this._execFile(this.command, args, {
        cwd: context.workDir,
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env, ...this.getEnvOverrides(context) },
      });

      const duration_ms = Date.now() - startTime;
      return this.parseOutput(stdout, stderr, duration_ms);
    } catch (error) {
      const duration_ms = Date.now() - startTime;

      if (error.killed) {
        return {
          status: 'failed',
          summary: `${this.name} timed out after ${this.timeoutMs}ms`,
          filesChanged: [],
          output: error.stderr || '',
          duration_ms,
        };
      }

      return {
        status: 'failed',
        summary: `${this.name} failed: ${error.message}`,
        filesChanged: [],
        output: error.stderr || error.stdout || '',
        duration_ms,
      };
    }
  }

  /**
   * Get environment variable overrides for the CLI process.
   * Override in subclasses to set agent-specific env vars.
   * @param {import('../types/index.js').TaskContext} context
   * @returns {Object}
   */
  getEnvOverrides(context) {
    return {};
  }

  /**
   * Abort the currently running task.
   * @returns {Promise<void>}
   */
  async abort() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
    }
  }
}
