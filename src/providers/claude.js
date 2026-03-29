import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { ProviderAdapter } from './base.js';

export class ClaudeAdapter extends ProviderAdapter {
  constructor() {
    super();
    this.authMountTarget = '/home/node/.claude';
    this.defaultAuthSource = join(homedir(), '.claude');
  }

  buildCliArgs(prompt, opts = {}) {
    return ['--print', '-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions', '--no-session-persistence'];
  }

  async buildAuthMounts(taskId, cfg = {}) {
    const sourceDir = cfg.mountFrom || this.defaultAuthSource;
    const mode = cfg.mode || 'ro';
    
    if (!sourceDir || !existsSync(sourceDir)) {
      return { args: [], cleanup: async () => {} };
    }

    return {
      args: ['-v', `${sourceDir}:${this.authMountTarget}:${mode}`],
      cleanup: async () => {}
    };
  }

  parseOutput(stdout, stderr, durationMs) {
    try {
      const parsed = JSON.parse(stdout);
      const isError = parsed.is_error === true;
      const summary = parsed.result ?? parsed.text ??
        (Array.isArray(parsed.content) ? parsed.content.filter(i => i.type === 'text').map(i => i.text).join('') : '') ??
        stdout.slice(0, 500);
      const token_usage = parsed.usage ? {
        input: parsed.usage.input_tokens,
        output: parsed.usage.output_tokens,
        cache_read: parsed.usage.cache_read_input_tokens,
        cost_usd: parsed.total_cost_usd,
      } : undefined;
      return { status: isError ? 'failed' : 'done', summary, token_usage, durationMs };
    } catch {
      return { status: 'done', summary: stdout.slice(0, 500), durationMs };
    }
  }

  defaultModel() {
    return 'claude-3-5-sonnet-latest';
  }
}
