import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentAdapter } from './base.js';
import { platformExec } from '../../platform/detect.js';

const execFileAsync = promisify(execFile);

/**
 * Adapter for Gemini CLI.
 *
 * Invokes: gemini -p "<prompt>" --output-format json --approval-mode=yolo
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

  contextFileName() {
    return 'GEMINI.md';
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
    // --approval-mode=yolo: auto-approve all tool actions (required for non-interactive agent use)
    const args = ['-p', prompt, '--output-format', 'json', '--approval-mode=yolo'];
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
      ? `\nNOTE: This task has failed ${task.retries} time(s) before. This may have been due to tool-access restrictions that are now resolved. You MUST ensure the requested files are written.\n`
      : '';

    const parts = [
      `Task: ${task.title}`,
      '',
      task.description,
      retryNote,
      `Working directory: ${context.workDir}`,
      `Branch: ${context.branch}`,
    ];

    // NOTE: Do NOT inject context.agentContext into the prompt here.
    // Gemini CLI reads GEMINI.md natively from the cwd as project instructions.
    // Embedding the same content in -p causes "Do NOT delegate to subagents"
    // to be interpreted twice, which strips Gemini's tool access (write_file, etc.).

    parts.push(
      '',
      'IMPORTANT: You must write output to a file. Do not just describe what you plan to do.',
      'Use your write_file tool to create or update files in your working directory.',
      '',
      'Constraints:',
      '- Only modify files within your assigned working directory.',
      '- When done, provide a brief summary of what files you created or changed.',
    );

    return parts.join('\n');
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

    // Try to parse the full output as JSON first.
    // Gemini CLI --output-format json may emit pretty-printed JSON (multi-line),
    // so splitting by '\n' and taking the last line is incorrect — the last line
    // is often just '}' which fails JSON.parse. Parsing the whole trimmed string
    // handles both single-line and pretty-printed output correctly.
    const parsed = this._tryParseJson(trimmed);
    if (parsed !== null) {
      return {
        status: 'done',
        summary: this._extractResultText(parsed) || trimmed.slice(0, 500),
        filesChanged: [],
        output: stdout,
        duration_ms,
      };
    }

    // No valid JSON found — Gemini produced plain text or a monologue.
    // Do NOT silently mark as done; surface this as a failure so the task
    // can be retried rather than accepted as successful with no file output.
    return {
      status: 'failed',
      summary: `Gemini produced no parseable JSON output. Raw output: ${trimmed.slice(0, 500)}`,
      filesChanged: [],
      output: stdout,
      duration_ms,
    };
  }

  /**
   * Attempt to parse a string as JSON, returning the parsed value or null.
   *
   * Tries three strategies in order:
   * 1. Parse the full string (handles both single-line and pretty-printed JSON).
   * 2. Scan lines from the end (handles NDJSON/streaming where each line is a JSON object).
   * 3. Extract the outermost {...} block (handles JSON with surrounding noise).
   *
   * @param {string} text
   * @returns {any|null}
   */
  _tryParseJson(text) {
    // Strategy 1: full string — handles single-line and pretty-printed JSON
    try { return JSON.parse(text); } catch { /* fall through */ }

    // Strategy 2: NDJSON/streaming — scan lines from end, return first valid JSON line
    if (text.includes('\n')) {
      const lines = text.split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try { return JSON.parse(lines[i]); } catch { /* try next */ }
      }
    }

    // Strategy 3: extract outermost {...} block (handles surrounding noise)
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }

    return null;
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
      // Use `git status --porcelain` to capture both modified tracked files
      // and newly created (untracked) files. `git diff --name-only HEAD` misses
      // untracked files, which is the common case when an agent writes new files
      // in a fresh worktree with no prior commits.
      const { stdout } = await platformExec(
        execFileAsync,
        'git',
        ['status', '--porcelain'],
        { cwd: workDir, timeout: 5_000 },
      );
      return stdout
        .split('\n')
        .map((line) => line.slice(3).trim())  // strip 2-char status code + space
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
