import { AgentAdapter } from './base.js';

/**
 * Adapter for Gemini CLI.
 *
 * Invokes: gemini -p "<prompt>" --output-format json
 * Works in the assigned git worktree directory.
 */
export class GeminiAdapter extends AgentAdapter {
  constructor(options = {}) {
    super('gemini', 'gemini', options);
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
   * Parse Gemini CLI JSON output into TaskResult.
   *
   * Gemini CLI with --output-format json returns newline-delimited JSON events
   * or a single JSON object depending on the mode.
   *
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} duration_ms
   * @returns {import('../types/index.js').TaskResult}
   */
  parseOutput(stdout, stderr, duration_ms) {
    try {
      // Try parsing as single JSON first
      const parsed = JSON.parse(stdout);
      return {
        status: 'done',
        summary: this._extractResultText(parsed),
        filesChanged: this._extractFilesChanged(parsed),
        output: stdout,
        duration_ms,
      };
    } catch {
      // Try parsing as newline-delimited JSON (stream-json format)
      try {
        const events = stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));

        const lastEvent = events[events.length - 1];
        return {
          status: 'done',
          summary: this._extractResultText(lastEvent),
          filesChanged: this._extractFilesChanged(lastEvent),
          output: stdout,
          duration_ms,
        };
      } catch {
        // Fallback: treat as plain text
        return {
          status: 'done',
          summary: stdout.slice(0, 500),
          filesChanged: [],
          output: stdout,
          duration_ms,
        };
      }
    }
  }

  /**
   * Extract human-readable result text from Gemini JSON output.
   * @param {Object} parsed
   * @returns {string}
   */
  _extractResultText(parsed) {
    if (typeof parsed === 'string') return parsed;
    if (parsed.response) return String(parsed.response);
    if (parsed.text) return String(parsed.text);
    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      return parsed.candidates
        .map((c) => c.content?.parts?.map((p) => p.text).join('') || '')
        .join('\n');
    }
    if (parsed.content) return String(parsed.content);
    return JSON.stringify(parsed).slice(0, 500);
  }

  /**
   * Extract list of changed files from Gemini JSON output.
   * @param {Object} parsed
   * @returns {string[]}
   */
  _extractFilesChanged(parsed) {
    if (parsed.files_changed) return parsed.files_changed;
    if (parsed.changes && Array.isArray(parsed.changes)) {
      return parsed.changes.map((c) => c.file || c.path).filter(Boolean);
    }
    return [];
  }
}
