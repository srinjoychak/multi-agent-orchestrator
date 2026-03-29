import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProviderAdapter } from './base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SETTINGS_HOST = join(__dirname, '../../docker/workers/config/gemini-settings.json');

export class GeminiAdapter extends ProviderAdapter {
  constructor() {
    super();
    this.authMountTarget = '/home/node/.gemini';
    this.defaultAuthSource = join(homedir(), '.gemini');
  }

  buildCliArgs(prompt, opts = {}) {
    const args = ['-p', prompt, '--approval-mode', 'yolo', '--output-format', 'json'];
    if (opts.is_delegated) {
      // Logic for boundary rules could be added here or to the prompt
    }
    return args;
  }

  async buildAuthMounts(taskId, cfg = {}) {
    const sourceDir = cfg.mountFrom || this.defaultAuthSource;
    const mode = cfg.mode || 'rw';
    
    if (!sourceDir || !existsSync(sourceDir)) {
      return { args: [], cleanup: async () => {} };
    }

    // Isolated auth for Gemini
    const tempDir = await mkdtemp(join(tmpdir(), `gemini-auth-${taskId}-`));
    
    try {
      const credFiles = ['oauth_creds.json', 'google_accounts.json', 'user_id', 'installation_id', 'state.json'];
      for (const f of credFiles) {
        const src = join(sourceDir, f);
        if (existsSync(src)) {
          await copyFile(src, join(tempDir, f));
        }
      }

      // Restore worker-safe settings.json overlay
      if (existsSync(WORKER_SETTINGS_HOST)) {
        await copyFile(WORKER_SETTINGS_HOST, join(tempDir, 'settings.json'));
      }

      return {
        args: ['-v', `${tempDir}:${this.authMountTarget}:${mode}`],
        cleanup: async () => {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      };
    } catch (err) {
      // Clean up on failure to prevent resource leaks
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  parseOutput(stdout, stderr, durationMs) {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { status: 'done', summary: '', durationMs };
    }

    let parsed = null;
    try { parsed = JSON.parse(trimmed); } catch { /* try next */ }
    if (!parsed && trimmed.includes('\n')) {
      for (const line of trimmed.split('\n').reverse()) {
        try { parsed = JSON.parse(line); break; } catch { /* try next */ }
      }
    }
    if (!parsed) {
      const s = trimmed.indexOf('{'), e = trimmed.lastIndexOf('}');
      if (s !== -1 && e > s) { try { parsed = JSON.parse(trimmed.slice(s, e + 1)); } catch { /* fail */ } }
    }

    if (parsed) {
      const summary = parsed.response ?? parsed.text ??
        (Array.isArray(parsed.candidates) ? parsed.candidates[0]?.content?.parts?.map(p => p.text).join('') : null) ??
        trimmed.slice(0, 500);

      const models = parsed.stats?.models ?? {};
      const firstModel = Object.values(models)[0];
      const token_usage = firstModel ? {
        input: firstModel.tokens?.input ?? 0,
        output: firstModel.tokens?.candidates ?? 0,
        thoughts: firstModel.tokens?.thoughts ?? 0,
        total: firstModel.tokens?.total ?? 0,
      } : undefined;

      return { status: 'done', summary, token_usage, durationMs };
    }

    return {
      status: trimmed.length > 20 ? 'done' : 'failed',
      summary: trimmed.slice(0, 500),
      durationMs
    };
  }

  defaultModel() {
    return 'gemini-2.0-flash';
  }
}
