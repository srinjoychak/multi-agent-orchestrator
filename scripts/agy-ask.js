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

import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, mkdir, copyFile, rm, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// --- Parse args ---
const args = process.argv.slice(2);
const promptIdx = args.findIndex(a => !a.startsWith('--'));
const prompt = promptIdx !== -1 ? args[promptIdx] : null;
const modelFlag = args.indexOf('--model');
const model = modelFlag !== -1 ? args[modelFlag + 1] : null;
const workDirFlag = args.indexOf('--work-dir');
const workDir = workDirFlag !== -1 ? args[workDirFlag + 1] : process.cwd();

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
    return { env: {}, cleanup: async () => {} };
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
    cleanup: async () => rm(tempHome, { recursive: true, force: true }).catch(() => {})
  };
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
const { env: authEnv, cleanup } = await isolatedAgyAuth();

const doCleanup = async (code) => {
  await cleanup();
  if (code !== undefined) process.exit(code);
};
process.on('SIGINT', () => doCleanup(130));
process.on('SIGTERM', () => doCleanup(143));
process.on('exit', () => cleanup().catch(() => {}));

const env = { ...process.env, ...authEnv };

const cliArgs = ['-p', prompt, '--dangerously-skip-permissions'];
if (model) cliArgs.push('--model', model);

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
  model: model ?? 'flash',
  exitCode: result.status,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(result.status ?? 0);
