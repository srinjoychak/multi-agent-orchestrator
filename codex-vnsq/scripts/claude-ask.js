#!/usr/bin/env node
/**
 * claude-ask.js — Lightweight Claude CLI adapter for Codex-VN-Squad
 *
 * Calls the Claude CLI directly in headless mode.
 */

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const promptIdx = args.findIndex((a) => !a.startsWith('--'));
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

const permArgs = unsafe
  ? ['--dangerously-skip-permissions']
  : ['--allowedTools', 'Edit,Write,Glob,Grep,Read'];

const claudeArgs = ['-p', prompt, '--output-format', 'json', ...permArgs];
if (model) claudeArgs.push('--model', model);

const result = spawnSync('claude', claudeArgs, {
  cwd: workDir,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Failed to spawn claude CLI:', result.error.message);
  process.exit(1);
}

if (result.stdout && result.stdout.length >= (32 * 1024 * 1024) * 0.9) {
  console.error('WARNING: output near buffer limit (32MB), response may be truncated');
}

let summary = '';
let tokenUsage = undefined;
let exitCode = result.status;

try {
  const parsed = JSON.parse((result.stdout ?? '').trim());
  summary = parsed.result ?? '';
  tokenUsage = parsed.usage ? {
    input: parsed.usage.input_tokens ?? 0,
    output: parsed.usage.output_tokens ?? 0,
    total: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0)
  } : undefined;
} catch {
  summary = (result.stdout ?? '').trim() || (result.stderr ?? '').trim();
}

const output = {
  summary,
  model: model ?? 'claude (session default)',
  exitCode,
  tokenUsage,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(result.status ?? 0);
