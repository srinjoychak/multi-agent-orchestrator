#!/usr/bin/env node
/**
 * codex-ask.js — Lightweight Codex CLI adapter for Codex-VN-Squad
 *
 * Calls the Codex CLI in non-interactive (`exec`) mode.
 */

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const promptIdx = args.findIndex((a) => !a.startsWith('--'));
const prompt = promptIdx !== -1 ? args[promptIdx] : null;
const modelFlag = args.indexOf('--model');
const model = modelFlag !== -1 ? args[modelFlag + 1] : null;
const workDirFlag = args.indexOf('--work-dir');
const workDir = workDirFlag !== -1 ? args[workDirFlag + 1] : process.cwd();

if (!prompt) {
  console.error('Usage: node scripts/codex-ask.js "<prompt>" [--model <model>] [--work-dir <path>]');
  process.exit(1);
}

const codexArgs = ['exec', '--json', '--full-auto', '--cd', workDir];
if (model) codexArgs.push('--model', model);
codexArgs.push(prompt);

const result = spawnSync('codex', codexArgs, {
  cwd: workDir,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Failed to spawn codex CLI:', result.error.message);
  process.exit(1);
}

if (result.stdout && result.stdout.length >= (32 * 1024 * 1024) * 0.9) {
  console.error('WARNING: output near buffer limit (32MB), response may be truncated');
}

let summary = '';
let tokenUsage = undefined;
const exitCode = result.status;

try {
  const lines = (result.stdout ?? '').split('\n').filter((line) => line.trim());
  for (const line of lines) {
    const parsed = JSON.parse(line);
    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
      summary = parsed.item.text ?? summary;
    }
    if (parsed.type === 'turn.completed' && parsed.usage) {
      tokenUsage = {
        input: parsed.usage.input_tokens ?? 0,
        output: parsed.usage.output_tokens ?? 0,
        total: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0)
      };
    }
  }
} catch {
  summary = (result.stdout ?? '').trim() || (result.stderr ?? '').trim();
}

const output = {
  summary,
  model: model ?? 'gpt-5.4-mini',
  exitCode,
  tokenUsage,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(result.status ?? 0);
