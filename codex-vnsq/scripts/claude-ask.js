#!/usr/bin/env node
/**
 * claude-ask.js - Claude adapter for Codex-VNSQ
 *
 * Calls the Claude CLI directly in non-interactive mode and returns a JSON
 * envelope suitable for downstream parsing.
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
  console.error('Usage: node scripts/claude-ask.js "<prompt>" [--model <model>] [--work-dir <path>]');
  process.exit(1);
}

const claudeArgs = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions', '--no-chrome'];
if (model) {
  claudeArgs.push('--model', model);
}

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

function parseOutput(stdout) {
  const trimmed = (stdout ?? '').trim();
  if (!trimmed) return { summary: '', raw: '' };

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // fall through
  }

  if (!parsed && trimmed.includes('\n')) {
    for (const line of trimmed.split('\n').reverse()) {
      try {
        parsed = JSON.parse(line);
        break;
      } catch {
        // continue
      }
    }
  }

  if (!parsed) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // ignore
      }
    }
  }

  if (parsed) {
    const summary = parsed.response ?? parsed.text ?? parsed.message ?? trimmed.slice(0, 2000);
    const tokenUsage = parsed.usage ?? parsed.tokenUsage ?? undefined;
    return { summary, tokenUsage, raw: trimmed };
  }

  return { summary: trimmed.slice(0, 2000), raw: trimmed };
}

const { summary, tokenUsage } = parseOutput(result.stdout);
const output = {
  summary,
  model: model ?? 'claude',
  exitCode: result.status,
  tokenUsage,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(result.status ?? 0);

