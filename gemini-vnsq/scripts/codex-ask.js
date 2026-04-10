#!/usr/bin/env node
/**
 * codex-ask.js — Lightweight Codex CLI adapter for VN-Squad v2
 *
 * Calls the Codex CLI in non-interactive (exec) mode.
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
  console.error('Usage: node scripts/codex-ask.js "<prompt>" [--model model] [--work-dir <path>]');
  process.exit(1);
}

// --- Main ---
const cliArgs = ['exec', '--json', prompt];
if (model) cliArgs.push('--model', model);

const result = spawnSync('codex', cliArgs, {
  cwd: workDir,
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Failed to spawn codex CLI:', result.error.message);
  process.exit(1);
}

let summary = '';
let tokenUsage = undefined;
let exitCode = result.status;

try {
  const lines = (result.stdout ?? '').split('\n').filter(l => l.trim());
  for (const line of lines) {
    const parsed = JSON.parse(line);
    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
      summary = parsed.item.text ?? '';
    }
    if (parsed.type === 'turn.completed' && parsed.usage) {
      tokenUsage = {
        input: parsed.usage.input_tokens ?? 0,
        output: parsed.usage.output_tokens ?? 0,
        total: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0)
      };
    }
  }
} catch (e) {
  summary = result.stdout.trim() || result.stderr.trim();
}

const output = {
  summary,
  model: model ?? 'gpt-5.4-mini',
  exitCode,
  tokenUsage,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(exitCode ?? 0);
