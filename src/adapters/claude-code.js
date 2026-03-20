import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentAdapter } from './base.js';

const execFileAsync = promisify(execFile);

/**
 * Adapter for Claude Code CLI.
 *
 * Invokes: claude -p "<prompt>" --output-format json --no-session-persistence
 * Works in the assigned git worktree directory.
 *
 * Real JSON output schema (--output-format json):
 *   { type: 'result', subtype: 'success'|'error_*', is_error: boolean,
 *     result: string, duration_ms: number, session_id: string, ... }
 */
export class ClaudeCodeAdapter extends AgentAdapter {
  constructor(options = {}) {
    super('claude-code', 'claude', {
      ...options,
      capabilities: ['code', 'refactor', 'test', 'review', 'debug'],
    });
  }

  getVersionFlag() {
    return '--version';
  }

  /**
   * Build CLI arguments for Claude Code.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string[]}
   */
  buildArgs(task, context) {
    const prompt = this._buildPrompt(task, context);
    return ['-p', prompt, '--output-format', 'json', '--no-session-persistence'];
  }

  /**
   * Build a detailed prompt from the task and context.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string}
   */
  _buildPrompt(task, context) {
    return [
      `Task: ${task.title}`,
      '',
      task.description,
      '',
      `Working directory: ${context.workDir}`,
      `Branch: ${context.branch}`,
      '',
      'Instructions:',
      '- Complete the task described above.',
      '- Only modify files relevant to this task.',
      '- Do not modify files outside the scope of this task.',
      '- When done, provide a summary of changes made.',
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

    // If no files were detected via parseOutput, try git diff as fallback
    if (!result.filesChanged || result.filesChanged.length === 0) {
      result.filesChanged = await this._getChangedFiles(context.workDir);
    }

    return result;
  }

  /**
   * Parse Claude Code JSON output into TaskResult.
   *
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} duration_ms
   * @returns {import('../types/index.js').TaskResult}
   */
  parseOutput(stdout, stderr, duration_ms) {
    try {
      const parsed = JSON.parse(stdout);
      const isError = parsed.is_error === true;

      let summary = '';
      if (parsed.result) {
        summary = parsed.result;
      } else if (parsed.text) {
        summary = parsed.text;
      } else if (Array.isArray(parsed.content)) {
        summary = parsed.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('');
      } else {
        summary = JSON.stringify(parsed).slice(0, 500);
      }

      return {
        status: isError ? 'failed' : 'done',
        summary,
        filesChanged: this._extractFilesChanged(parsed),
        output: stdout,
        duration_ms,
      };
    } catch {
      // If JSON parsing fails, treat raw output as the result
      return {
        status: 'done',
        summary: stdout.slice(0, 500),
        filesChanged: [],
        output: stdout,
        duration_ms,
      };
    }
  }

  /**
   * Extract list of changed files from parsed JSON output.
   * @param {any} parsed
   * @returns {string[]}
   */
  _extractFilesChanged(parsed) {
    if (Array.isArray(parsed.files_changed)) {
      return parsed.files_changed;
    }
    if (Array.isArray(parsed.changes)) {
      return parsed.changes
        .filter((c) => c && typeof c.file === 'string')
        .map((c) => c.file);
    }
    return [];
  }

  /**
   * Get list of files changed in the worktree since the last commit.
   * @param {string} workDir
   * @returns {Promise<string[]>}
   */
  async _getChangedFiles(workDir) {
    try {
      const { stdout } = await execFileAsync(
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
