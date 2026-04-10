#!/usr/bin/env node
/**
 * claude-ask.js — Lightweight Claude CLI adapter for VN-Squad v2
 *
 * Calls the Claude CLI directly in headless mode.
 */

import { spawnSync } from 'node:child_process';

// --- Parse args ---
const args = process.argv.slice(2);
const promptIdx = args.findIndex(a => !a.startsWith('--'));
const prompt = promptIdx !== -1 ? args[promptIdx] : null;
const modelFlag = args.indexOf('--model');
const model = modelFlag !== -1 ? args[modelFlag + 1] : null;
const workDirFlag = args.indexOf('--work-dir');
const workDir = workDirFlag !== -1 ? args[workDirFlag + 1] : process.cwd();

if (!prompt) {
  console.error('Usage: node scripts/claude-ask.js "<prompt>" [--model sonnet|opus] [--work-dir <path>]');
  process.exit(1);
}

// --- Main ---
const cliArgs = ['-p', prompt, '--output-format', 'json', '--bare', '--dangerously-skip-permissions'];
if (model) cliArgs.push('--model', model);

const result = spawnSync('claude', cliArgs, {
  cwd: workDir,
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Failed to spawn claude CLI:', result.error.message);
  process.exit(1);
}

let summary = '';
let tokenUsage = undefined;
let exitCode = result.status;

try {
  const parsed = JSON.parse(result.stdout.trim());
  summary = parsed.result ?? '';
  tokenUsage = parsed.usage ? {
    input: parsed.usage.input_tokens ?? 0,
    output: parsed.usage.output_tokens ?? 0,
    total: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0)
  } : undefined;
} catch (e) {
  summary = result.stdout.trim() || result.stderr.trim();
}

const output = {
  summary,
  model: model ?? 'claude-3-5-sonnet',
  exitCode,
  tokenUsage,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(exitCode ?? 0);
