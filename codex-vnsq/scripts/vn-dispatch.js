#!/usr/bin/env node
/**
 * vn-dispatch.js — Parallel agent dispatcher for Codex-VN-Squad
 *
 * Parses annotated task lines, creates isolated git worktrees, and runs the
 * Codex / Claude / Gemini adapters in parallel.
 *
 * Usage:
 *   node codex-vnsq/scripts/vn-dispatch.js [--worktree-root <path>] [--base <ref>] [--cleanup] [--input-file <path>]
 *
 * Input format:
 *   [codex] do a thing
 *   [claude --model sonnet] do another thing
 *   [gemini --model pro] research this topic
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createWriteStream } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: __dirname,
  encoding: 'utf8',
}).stdout.trim();

function usage() {
  console.error('Usage: node codex-vnsq/scripts/vn-dispatch.js [--worktree-root <path>] [--base <ref>] [--cleanup] [--input-file <path>]');
  process.exit(1);
}

function slugify(text, fallback = 'task') {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function parseTasks(text) {
  const tasks = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^\[(codex|claude|gemini)(?:\s+--model\s+([^\]]+))?\]\s*(.+)$/i);
    if (!match) continue;

    tasks.push({
      agent: match[1].toLowerCase(),
      model: match[2]?.trim() || null,
      prompt: match[3].trim(),
    });
  }
  return tasks;
}

async function readInput(argv) {
  const inputFileFlag = argv.indexOf('--input-file');
  if (inputFileFlag !== -1) {
    const inputPath = argv[inputFileFlag + 1];
    if (!inputPath) usage();
    return readFile(inputPath, 'utf8');
  }

  const skipNext = new Set(['--worktree-root', '--base', '--input-file']);
  const explicitParts = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (skipNext.has(arg)) i += 1;
      continue;
    }
    explicitParts.push(arg);
  }
  const explicit = explicitParts.join(' ').trim();
  if (explicit) return explicit;

  if (!process.stdin.isTTY) {
    return await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }

  usage();
}

async function createWorktree(baseRef, branchName, worktreePath) {
  await mkdir(dirname(worktreePath), { recursive: true });
  const result = spawnSync('git', ['worktree', 'add', '--force', '-b', branchName, worktreePath, baseRef], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`git worktree add failed for ${branchName}: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

function buildAdapterCommand(task, worktreePath) {
  const base = join(REPO_ROOT, 'codex-vnsq', 'scripts');
  const scriptName = `${task.agent}-ask.js`;
  const scriptPath = join(base, scriptName);
  const cliArgs = [scriptPath, task.prompt, '--work-dir', worktreePath];
  if (task.model) cliArgs.push('--model', task.model);
  return cliArgs;
}

async function runTask(task, index, options) {
  const taskId = `${index + 1}-${task.agent}-${slugify(task.prompt)}`;
  const branchName = `${options.branchPrefix}-${task.agent}-${index + 1}-${slugify(task.prompt)}`;
  const worktreePath = join(options.worktreeRoot, branchName);
  const stdoutFile = `/tmp/vnsq-${taskId}.stdout.json`;
  const stderrFile = `/tmp/vnsq-${taskId}.stderr.log`;
  const exitFile = `/tmp/vnsq-${taskId}.exit`;

  await createWorktree(options.baseRef, branchName, worktreePath);

  const stdoutStream = createWriteStream(stdoutFile, { flags: 'w' });
  const stderrStream = createWriteStream(stderrFile, { flags: 'w' });

  const proc = spawn('node', buildAdapterCommand(task, worktreePath), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.pipe(stdoutStream);
  proc.stderr.pipe(stderrStream);

  const exitCode = await new Promise((resolve) => {
    proc.on('close', (code) => resolve(code ?? 1));
  });

  stdoutStream.end();
  stderrStream.end();
  await Promise.all([
    new Promise((resolve) => stdoutStream.on('finish', resolve)),
    new Promise((resolve) => stderrStream.on('finish', resolve)),
  ]);

  await writeFile(exitFile, `${exitCode}\n`);

  let summary = '';
  let tokenUsage = undefined;
  try {
    const parsed = JSON.parse(await readFile(stdoutFile, 'utf8'));
    summary = parsed.summary ?? '';
    tokenUsage = parsed.tokenUsage ?? undefined;
  } catch {
    summary = (await readFile(stdoutFile, 'utf8')).trim();
  }

  return {
    id: taskId,
    agent: task.agent,
    model: task.model,
    prompt: task.prompt,
    branch: branchName,
    worktree: worktreePath,
    stdoutFile,
    stderrFile,
    exitFile,
    exitCode,
    summary,
    tokenUsage,
  };
}

async function cleanupTaskArtifacts(results, options) {
  if (!options.cleanup && !options.force) return;

  for (const result of results) {
    spawnSync('git', ['worktree', 'remove', '--force', result.worktree], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    rmSync(result.worktree, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    spawnSync('git', ['branch', '-D', result.branch], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const worktreeRootFlag = args.indexOf('--worktree-root');
  const worktreeRoot = worktreeRootFlag !== -1 ? args[worktreeRootFlag + 1] : join(REPO_ROOT, '.worktrees');
  const baseFlag = args.indexOf('--base');
  const baseRef = baseFlag !== -1 ? args[baseFlag + 1] : 'HEAD';
  const inputFileFlag = args.indexOf('--input-file');
  const cleanup = args.includes('--cleanup');
  const branchPrefix = `vnsq-${basename(REPO_ROOT)}-${Date.now().toString(36)}`;

  if (worktreeRootFlag !== -1 && !worktreeRoot) usage();
  if (baseFlag !== -1 && !baseRef) usage();
  if (inputFileFlag !== -1 && !args[inputFileFlag + 1]) usage();

  const input = await readInput(args);
  const tasks = parseTasks(input);

  if (tasks.length === 0) {
    console.error('No annotated tasks found. Use lines like: [claude] write tests for src/foo.js');
    process.exit(1);
  }

  await mkdir(worktreeRoot, { recursive: true });

  const results = new Array(tasks.length).fill(null);
  const failures = [];

  await Promise.all(tasks.map(async (task, index) => {
    try {
      const result = await runTask(task, index, { worktreeRoot, baseRef, branchPrefix, cleanup });
      results[index] = result;
      if (result.exitCode !== 0) failures.push(result);
    } catch (error) {
      const failureRecord = {
        id: `${index + 1}-${task.agent}-${slugify(task.prompt)}`,
        agent: task.agent,
        model: task.model,
        prompt: task.prompt,
        error: error instanceof Error ? error.message : String(error),
        worktree: join(worktreeRoot, `${branchPrefix}-${task.agent}-${index + 1}-${slugify(task.prompt)}`),
        branch: `${branchPrefix}-${task.agent}-${index + 1}-${slugify(task.prompt)}`,
      };
      results[index] = failureRecord;
      failures.push(failureRecord);
    }
  }));

  // Always clean up worktrees for failed tasks; clean up successful ones only when --cleanup is set
  const failedResults = failures.filter(f => f.worktree);
  const successfulResults = results.filter(r => r && !failures.includes(r));
  await cleanupTaskArtifacts(failedResults, { cleanup: true, force: true });
  await cleanupTaskArtifacts(successfulResults, { cleanup });

  const output = {
    success: failures.length === 0,
    worktreeRoot,
    baseRef,
    results,
    failures,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
