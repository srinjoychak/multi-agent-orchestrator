import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { ProviderAdapter } from './base.js';

export class CodexAdapter extends ProviderAdapter {
  constructor() {
    super();
    this.authMountTarget = '/home/node/.codex';
    this.defaultAuthSource = join(homedir(), '.codex');
  }

  buildCliArgs(prompt, opts = {}) {
    return [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--cd',
      '/work',
      prompt,
    ];
  }

  async buildAuthMounts(taskId, cfg = {}) {
    const sourceDir = cfg.mountFrom || this.defaultAuthSource;
    const mode = cfg.mode || 'rw';
    
    if (!sourceDir || !existsSync(sourceDir)) {
      return { args: [], cleanup: async () => {} };
    }

    return {
      args: ['-v', `${sourceDir}:${this.authMountTarget}:${mode}`],
      cleanup: async () => {}
    };
  }

  parseOutput(stdout, stderr, durationMs) {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return {
        status: stderr?.trim() ? 'failed' : 'done',
        summary: stderr?.slice(0, 500) ?? '',
        durationMs
      };
    }

    const events = [];
    for (const line of trimmed.split('\n')) {
      const value = line.trim();
      if (!value) continue;
      try {
        events.push(JSON.parse(value));
      } catch {
        // Ignore non-JSON lines
      }
    }

    if (events.length === 0) {
      return { status: 'done', summary: trimmed.slice(0, 500), durationMs };
    }

    let status = 'done';
    let summary = '';
    let token_usage;

    for (const event of events) {
      const eventType = String(event.type ?? '').toLowerCase();
      if (eventType.includes('error') || event.error) {
        status = 'failed';
      }

      const text = this._extractTextFromJson(event);
      if (text) summary = text;

      if (!token_usage) {
        const usage = event.usage ?? event.token_usage ?? event.metrics?.usage;
        if (usage) {
          token_usage = {
            input: usage.input_tokens ?? usage.input ?? 0,
            output: usage.output_tokens ?? usage.output ?? 0,
            total: usage.total_tokens ?? usage.total ?? 0,
          };
        }
      }
    }

    if (!summary) {
      summary = stderr?.trim() ? stderr.slice(0, 500) : trimmed.slice(0, 500);
    }

    return { status, summary, token_usage, durationMs };
  }

  _extractTextFromJson(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';

    for (const key of ['summary', 'message', 'content', 'text', 'result']) {
      if (key in value) {
        const nested = this._extractTextFromJson(value[key]);
        if (nested) return nested;
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = this._extractTextFromJson(item);
        if (nested) return nested;
      }
    }

    if (value.delta && typeof value.delta === 'object') {
      const nested = this._extractTextFromJson(value.delta);
      if (nested) return nested;
    }

    return '';
  }

  defaultModel() {
    return 'gpt-4o';
  }
}
