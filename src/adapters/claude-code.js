import { AgentAdapter } from './base.js';

/**
 * Adapter for Claude Code CLI.
 *
 * Invokes: claude -p "<prompt>" --output-format json
 * Works in the assigned git worktree directory.
 */
export class ClaudeCodeAdapter extends AgentAdapter {
  constructor(options = {}) {
    super('claude-code', 'claude', options);
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
    return ['-p', prompt, '--output-format', 'json'];
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
   * Parse Claude Code JSON output into TaskResult.
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} duration_ms
   * @returns {import('../types/index.js').TaskResult}
   */
  parseOutput(stdout, stderr, duration_ms) {
    try {
      const parsed = JSON.parse(stdout);

      // Claude Code --output-format json returns a structured response
      // Extract the result text and any file changes
      const resultText = this._extractResultText(parsed);
      const filesChanged = this._extractFilesChanged(parsed);

      return {
        status: 'done',
        summary: resultText,
        filesChanged,
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
   * Extract human-readable result text from Claude Code JSON output.
   * @param {Object} parsed
   * @returns {string}
   */
  _extractResultText(parsed) {
    // Claude Code JSON output structure may vary — handle common shapes
    if (typeof parsed === 'string') return parsed;
    if (parsed.result) return String(parsed.result);
    if (parsed.text) return String(parsed.text);
    if (parsed.content) {
      if (typeof parsed.content === 'string') return parsed.content;
      if (Array.isArray(parsed.content)) {
        return parsed.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
      }
    }
    return JSON.stringify(parsed).slice(0, 500);
  }

  /**
   * Extract list of changed files from Claude Code JSON output.
   * @param {Object} parsed
   * @returns {string[]}
   */
  _extractFilesChanged(parsed) {
    // Look for file change indicators in the output
    if (parsed.files_changed) return parsed.files_changed;
    if (parsed.changes && Array.isArray(parsed.changes)) {
      return parsed.changes.map((c) => c.file || c.path).filter(Boolean);
    }
    return [];
  }
}
