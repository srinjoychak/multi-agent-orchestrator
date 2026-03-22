import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { platformExec } from '../../platform/detect.js';

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
   * @param {Object} [options.agentConfig={}] - Agent config block from agents.json
   */
  constructor(name, command, options = {}) {
    this.name = name;
    this.command = command;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.agentConfig = options.agentConfig ?? {};
    // agentConfig.capabilities (from agents.json) takes priority over subclass defaults
    this.capabilities = this.agentConfig.capabilities ?? options.capabilities ?? [];
    this._process = null;
  }

  /**
   * Resolve the model to use for a given task type.
   * Looks up agentConfig.models[taskType], falls back to models.default.
   * Returns undefined when no model config is present.
   * @param {string|null|undefined} taskType
   * @returns {string|undefined}
   */
  getModel(taskType) {
    const models = this.agentConfig.models;
    if (!models) return undefined;
    return (taskType && models[taskType]) || models.default;
  }

  /**
   * Check if the CLI tool is installed and available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
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
   * Internal wrapper for execFile. On Windows, routes through cmd.exe /c
   * so that npm-installed .cmd wrappers (gemini, etc.) resolve correctly.
   * On Linux/macOS, spawns directly.
   * @param {string} command
   * @param {string[]} args
   * @param {Object} options
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async _execFile(command, args, options) {
    return platformExec(execFileAsync, command, args, options);
  }

  /**
   * Return the filename for the native context file this agent reads automatically.
   * Override in subclasses: 'GEMINI.md' for Gemini, 'CLAUDE.md' for Claude Code.
   * This file is written to the worktree root before each execution, overriding any
   * global config (e.g. ~/.gemini/GEMINI.md) to prevent cross-task memory poisoning.
   * @returns {string}
   */
  contextFileName() {
    return 'AGENT_CONTEXT.md';
  }

  /**
   * Build the content of the per-worktree context file.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string}
   */
  buildContextFile(task, context) {
    return [
      `# Task Context — ${task.id}`,
      ``,
      `**Agent:** ${this.name}`,
      `**Task:** ${task.title}`,
      `**Branch:** ${context.branch}`,
      ``,
      `## Objective`,
      task.description,
      ``,
      `## Constraints`,
      `- Work only within: ${context.workDir}`,
      `- Do NOT modify files outside this worktree.`,
      `- Do NOT use save_memory or write to global config files.`,
      `- Do NOT delegate to subagents.`,
    ].join('\n');
  }

  /**
   * Load the per-worktree context file (AGENT_CONTEXT.md) if it exists.
   * Returns the file content, or null if not found.
   * @param {string} workDir
   * @returns {Promise<string|null>}
   */
  async _loadContextFile(workDir) {
    try {
      const content = await readFile(join(workDir, this.contextFileName()), 'utf8');
      return content.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Execute a task using the CLI tool.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {Promise<import('../types/index.js').TaskResult>}
   */
  async execute(task, context) {
    // Write native context file (GEMINI.md / CLAUDE.md) to worktree root.
    // This overrides the agent's global config file, preventing cross-task memory poisoning.
    const ctxPath = join(context.workDir, this.contextFileName());
    await writeFile(ctxPath, this.buildContextFile(task, context), 'utf-8');

    const agentContext = await this._loadContextFile(context.workDir);
    const enrichedContext = agentContext ? { ...context, agentContext } : context;
    const args = this.buildArgs(task, enrichedContext);
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
