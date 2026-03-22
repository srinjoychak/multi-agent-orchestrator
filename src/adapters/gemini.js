import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentAdapter } from './base.js';
import { platformExec } from '../../platform/detect.js';

const execFileAsync = promisify(execFile);

/**
 * Adapter for Gemini CLI.
 *
 * Invokes: gemini -p "<prompt>" --output-format json --yolo
 * Works in the assigned git worktree directory.
 *
 * Real JSON output schema (--output-format json):
 *   { session_id: string, response: string, stats: { models: {...} } }
 */
export class GeminiAdapter extends AgentAdapter {
  constructor(options = {}) {
    super('gemini', 'gemini', {
      ...options,
      capabilities: ['research', 'docs', 'analysis', 'code', 'test'],
    });
  }

  getVersionFlag() {
    return '--version';
  }

  /**
   * Build CLI arguments for Gemini CLI.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string[]}
   */
  buildArgs(task, context) {
    const prompt = this._buildPrompt(task, context);
    // --yolo: auto-approve all tool actions (required for non-interactive agent use)
    const args = ['-p', prompt, '--output-format', 'json', '--yolo'];
    const model = this.getModel(task.type);
    if (model) args.push('--model', model);
    return args;
  }

  /**
   * Build a detailed prompt from the task and context.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string}
   */
  _buildPrompt(task, context) {
    const retryNote = task.retries > 0
      ? `\nNOTE: This task has failed ${task.retries} time(s) before. Previous attempts did not write files. You MUST write files this time.\n`
      : '';

    return [
      `Task: ${task.title}`,
      '',
      task.description,
      retryNote,
      `Working directory: ${context.workDir}`,
      `Branch: ${context.branch}`,
      '',
      'RULES — read these carefully before doing anything:',
      '1. Your FIRST action must be to write or edit the required files. Do not spend time reading files unless the task explicitly requires it to determine what to write.',
      '2. Use your file writing tools (write_file, replace, create) directly. Do NOT use shell commands to write files.',
      '3. Do NOT describe what you plan to do. Just do it immediately.',
      '4. Do NOT delegate to a subagent. You must write the files yourself.',
      '5. Only modify files that are directly required by this task.',
      '6. When all required files are written, provide a brief summary: which files you changed and what you changed.',
    ].join('\n');
  }

  /**
   * Execute a task and detect changed files via git diff after completion.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {Promise<import('../types/index.js').TaskResult>}
   */
  async execute(task, context) {
    const result = await super.execute(task, context);

    // Detect changed files via git diff — the JSON output does not include them
    result.filesChanged = await this._getChangedFiles(context.workDir);

    return result;
  }

  /**
   * Parse Gemini CLI JSON output into TaskResult.
   *
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} duration_ms
   * @returns {import('../types/index.js').TaskResult}
   */
  parseOutput(stdout, stderr, duration_ms) {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return {
        status: 'done',
        summary: '',
        filesChanged: [],
        output: stdout,
        duration_ms,
      };
    }

    try {
      // Handle newline-delimited JSON (stream format)
      if (trimmed.includes('\n')) {
        const lines = trimmed.split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1];
        const parsed = JSON.parse(lastLine);
        return {
          status: 'done',
          summary: this._extractResultText(parsed) || lastLine.slice(0, 500),
          filesChanged: [],
          output: stdout,
          duration_ms,
        };
      }

      // Handle single JSON object
      const parsed = JSON.parse(trimmed);
      return {
        status: 'done',
        summary: this._extractResultText(parsed) || trimmed.slice(0, 500),
        filesChanged: [],
        output: stdout,
        duration_ms,
      };
    } catch {
      // Fallback: treat as plain text
      return {
        status: 'done',
        summary: trimmed.slice(0, 500),
        filesChanged: [],
        output: stdout,
        duration_ms,
      };
    }
  }

  /**
   * Extract response text from various possible Gemini JSON shapes.
   * @param {any} parsed
   * @returns {string|null}
   */
  _extractResultText(parsed) {
    if (typeof parsed.response === 'string') {
      return parsed.response;
    }
    if (Array.isArray(parsed.candidates) && parsed.candidates[0]?.content?.parts) {
      return parsed.candidates[0].content.parts
        .map((p) => p.text)
        .filter(Boolean)
        .join('');
    }
    return null;
  }

  /**
   * Get list of files changed in the worktree since the last commit.
   * @param {string} workDir
   * @returns {Promise<string[]>}
   */
  async _getChangedFiles(workDir) {
    try {
      const { stdout } = await platformExec(
        execFileAsync,
        'git',
        ['diff', '--name-only', 'HEAD'],
        { cwd: workDir, timeout: 5_000 },
      );
      return stdout.split('\n').map((f) => f.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}
