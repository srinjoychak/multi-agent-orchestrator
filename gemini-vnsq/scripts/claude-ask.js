#!/usr/bin/env node
/**
 * claude-ask.js — Lightweight Claude CLI adapter for Gemini-VN-Squad
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
const unsafe = args.includes('--unsafe');

if (!prompt) {
  console.error('Usage: node scripts/claude-ask.js "<prompt>" [--model sonnet|opus] [--work-dir <path>] [--unsafe]');
  process.exit(1);
}

// --- Permissions ---
const permArgs = unsafe
  ? ['--dangerously-skip-permissions']
  : ['--allowedTools', 'Edit,Write,Bash,Glob,Grep,Read'];

// --- Main ---
const cliArgs = ['-p', prompt, '--output-format', 'json', '--bare', ...permArgs];
if (model) cliArgs.push('--model', model);

const MAX_BUFFER = 32 * 1024 * 1024;
const result = spawnSync('claude', cliArgs, {
  cwd: workDir,
  env: process.env,
  encoding: 'utf8',
  maxBuffer: MAX_BUFFER,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Failed to spawn claude CLI:', result.error.message);
  process.exit(1);
}

// Check for buffer truncation
if (result.stdout && result.stdout.length >= MAX_BUFFER * 0.9) {
  console.error('WARNING: output near buffer limit (32MB), response may be truncated');
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
