#!/usr/bin/env node
/**
 * agy-ask.js — Lightweight Antigravity CLI adapter for VN-Squad v2
 *
 * Calls the Antigravity CLI (`agy`) directly (no Docker) with isolated auth.
 * Ported from gemini-ask.js after Google decommissioned Gemini CLI in favor
 * of Antigravity CLI (June 2026).
 *
 * Usage:
 *   node scripts/agy-ask.js "<prompt>" [--model flash|pro] [--work-dir <path>]
 */

import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, mkdir, copyFile, rm, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

// --- Parse args ---
const args = process.argv.slice(2);
const promptIdx = args.findIndex(a => !a.startsWith('--'));
const prompt = promptIdx !== -1 ? args[promptIdx] : null;
const modelFlag = args.indexOf('--model');
const model = modelFlag !== -1 ? args[modelFlag + 1] : null;
const workDirFlag = args.indexOf('--work-dir');
// Resolve to absolute: agy resolves --add-dir relative to its own cwd (already
// workDir), so a relative value would double up into a wrong nested path.
const workDir = resolve(workDirFlag !== -1 ? args[workDirFlag + 1] : process.cwd());

if (!prompt) {
  console.error('Usage: node scripts/agy-ask.js "<prompt>" [--model flash|pro] [--work-dir <path>]');
  process.exit(1);
}

// --- Isolated auth ---
// agy stores its OAuth token at ~/.gemini/antigravity-cli/antigravity-oauth-token
// (Antigravity reuses the ~/.gemini home for historical reasons). There is no
// API-key auth and no config-dir override env var, so isolation works by
// pointing $HOME at a scratch dir that only contains the copied token.
async function isolatedAgyAuth() {
  const sourceDir = join(homedir(), '.gemini', 'antigravity-cli');
  const tokenFile = join(sourceDir, 'antigravity-oauth-token');
  if (!existsSync(tokenFile)) {
    return { env: {}, tempHome: null, cleanup: async () => {} };
  }

  const tempHome = await mkdtemp(join(tmpdir(), 'agy-auth-'));
  await chmod(tempHome, 0o700);

  const tempCliDir = join(tempHome, '.gemini', 'antigravity-cli');
  await mkdir(tempCliDir, { recursive: true });

  const credFiles = ['antigravity-oauth-token', 'installation_id'];
  for (const f of credFiles) {
    const src = join(sourceDir, f);
    if (existsSync(src)) {
      await copyFile(src, join(tempCliDir, f));
    }
  }

  // Deliberately do NOT copy settings.json, config/mcp_config.json, or
  // plugins/ — an empty scratch $HOME means no host MCP servers or plugins
  // load inside the worker subprocess.

  return {
    env: { HOME: tempHome },
    tempHome,
    cleanup: async () => rm(tempHome, { recursive: true, force: true }).catch(() => {})
  };
}

// --- Model resolution ---
// `agy models` only lists full display names (e.g. "Gemini 3.1 Pro (High)").
// agy does NOT validate --model: passing a short alias like "pro", or any
// unrecognized string, silently falls back to its own default with exit 0 —
// confirmed by hands-on testing. Map our documented flash|pro aliases to the
// exact strings agy actually accepts; anything else is passed through as-is
// (in case the caller wants a specific model directly) but flagged.
const MODEL_ALIASES = {
  flash: 'Gemini 3.5 Flash (Medium)',
  pro: 'Gemini 3.1 Pro (High)',
};
function resolveModel(rawModel) {
  if (!rawModel) return null;
  const resolved = MODEL_ALIASES[rawModel.toLowerCase()];
  if (!resolved) {
    console.error(`WARNING: --model "${rawModel}" is not a known alias (flash|pro). Passing it through as-is — if it isn't an exact match from \`agy models\`, agy will silently ignore it and use its own default.`);
    return rawModel;
  }
  return resolved;
}

// --- Output parsing ---
// agy has no JSON output mode. Strip the trailing "**Summary of work**:" block
// agy sometimes appends and return the rest as plain text.
function parseOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return { summary: '' };

  const summaryMarker = trimmed.search(/\n\s*\*\*Summary of work\*\*:?/i);
  const summary = summaryMarker !== -1 ? trimmed.slice(0, summaryMarker).trim() : trimmed;

  return { summary: summary.slice(0, 4000) };
}

// --- Main ---
const { env: authEnv, tempHome, cleanup } = await isolatedAgyAuth();

const doCleanup = async (code) => {
  await cleanup();
  if (code !== undefined) process.exit(code);
};
process.on('SIGINT', () => doCleanup(130));
process.on('SIGTERM', () => doCleanup(143));
// 'exit' only supports synchronous work — the async cleanup() above cannot
// reliably finish here, so this is a last-resort sync fallback for crash paths.
process.on('exit', () => {
  if (tempHome) {
    try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

const env = { ...process.env, ...authEnv };

// Without --add-dir, agy sandboxes all file writes into its own
// $HOME/.gemini/antigravity-cli/scratch/ instead of workDir, even though
// `cwd` is set correctly below — confirmed by hands-on testing.
// agy's own --print-timeout defaults to 5m0s and silently returns whatever
// output it has so far when it fires — too short for larger dispatch tasks.
const resolvedModel = resolveModel(model);
const cliArgs = ['-p', prompt, '--dangerously-skip-permissions', '--add-dir', workDir, '--print-timeout', '15m'];
if (resolvedModel) cliArgs.push('--model', resolvedModel);

const MAX_BUFFER = 32 * 1024 * 1024;
const result = spawnSync('agy', cliArgs, {
  cwd: workDir,
  env,
  encoding: 'utf8',
  maxBuffer: MAX_BUFFER,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.stdout && result.stdout.length >= MAX_BUFFER * 0.9) {
  console.error('WARNING: output near buffer limit (32MB), response may be truncated');
}

await cleanup();
process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');

if (result.error) {
  console.error('Failed to spawn agy CLI:', result.error.message);
  process.exit(1);
}

const { summary } = parseOutput(result.stdout ?? '');
const output = {
  summary,
  model: resolvedModel ?? MODEL_ALIASES.flash,
  exitCode: result.status,
};

// agy writes diagnostic info (timeouts, auth failures) to stderr on
// failure — surface it so callers can diagnose a non-zero exit rather than
// only seeing an empty/unhelpful summary. Confirmed via `--print-timeout 1s`.
if (result.stderr && result.stderr.trim()) {
  output.stderr = result.stderr.trim();
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(result.status ?? 0);
