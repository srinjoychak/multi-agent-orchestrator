import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { TaskManager } from '../taskmanager/index.js';
import { TokenTracker } from './index.js';

/**
 * Create a fresh isolated temp directory for a test suite.
 * Returns { dir, manager, tracker, cleanup }.
 */
async function makeTestEnv() {
  const dir = join(tmpdir(), `tracker-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const manager = new TaskManager(dir);
  await manager.initialize();
  const tracker = new TokenTracker(manager);
  return {
    dir,
    manager,
    tracker,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('TokenTracker.parseClaude()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('parses valid single-line JSON with usage field', () => {
    const stdout = '{"usage": {"input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 10}, "cost_usd": 0.01}';
    const result = env.tracker.parseClaude(stdout);
    assert.deepEqual(result, {
      input: 100,
      output: 50,
      cache_read: 10,
      cost_usd: 0.01
    });
  });

  it('parses valid single-line JSON with direct usage fields', () => {
    const stdout = '{"input_tokens": 100, "output_tokens": 50, "cost_usd": 0.01}';
    const result = env.tracker.parseClaude(stdout);
    assert.deepEqual(result, {
      input: 100,
      output: 50,
      cache_read: 0,
      cost_usd: 0.01
    });
  });

  it('parses embedded JSON in multi-line stdout', () => {
    const stdout = 'Some logs...\n{"usage": {"input_tokens": 200, "output_tokens": 100}, "cost_usd": 0.02}\nMore logs...';
    const result = env.tracker.parseClaude(stdout);
    assert.deepEqual(result, {
      input: 200,
      output: 100,
      cache_read: 0,
      cost_usd: 0.02
    });
  });

  it('returns null for invalid JSON', () => {
    const stdout = 'Not a JSON string';
    const result = env.tracker.parseClaude(stdout);
    assert.equal(result, null);
  });

  it('returns null for JSON without usage fields', () => {
    const stdout = '{"foo": "bar"}';
    const result = env.tracker.parseClaude(stdout);
    assert.equal(result, null);
  });
});

describe('TokenTracker.parseGemini()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('estimates tokens based on character length (chars/4)', () => {
    const prompt = 'abcd'.repeat(25); // 100 chars -> 25 tokens
    const stdout = 'abcd'.repeat(50); // 200 chars -> 50 tokens
    const result = env.tracker.parseGemini(stdout, prompt);
    assert.deepEqual(result, {
      input_est: 25,
      output_est: 50,
      cost_usd: 0
    });
  });

  it('handles empty input/output', () => {
    const result = env.tracker.parseGemini('', '');
    assert.deepEqual(result, {
      input_est: 0,
      output_est: 0,
      cost_usd: 0
    });
  });
});

describe('TokenTracker.record() and aggregation', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('records usage and aggregates by agent', async () => {
    // Add some tasks
    await env.manager.addTask({ id: 'T1', title: 'Task 1' });
    await env.manager.addTask({ id: 'T2', title: 'Task 2' });
    await env.manager.addTask({ id: 'T3', title: 'Task 3' });

    // Claim them
    await env.manager.claimTask('T1', 'claude-3');
    await env.manager.claimTask('T2', 'claude-3');
    await env.manager.claimTask('T3', 'gemini-1.5');

    // Record usage
    await env.tracker.record('T1', { input: 100, output: 50, cost_usd: 0.001 });
    await env.tracker.record('T2', { input: 200, output: 100, cost_usd: 0.002 });
    await env.tracker.record('T3', { input_est: 300, output_est: 150, cost_usd: 0 });

    // Verify record directly in DB
    const task1 = await env.manager.getTask('T1');
    assert.deepEqual(task1.token_usage, { input: 100, output: 50, cost_usd: 0.001 });

    // Verify summaryByAgent
    const summary = await env.tracker.summaryByAgent();
    assert.equal(summary.length, 2);

    const claudeSummary = summary.find(s => s.agent === 'claude-3');
    assert.ok(claudeSummary);
    assert.equal(claudeSummary.task_count, 2);
    assert.equal(claudeSummary.total_input, 300);
    assert.equal(claudeSummary.total_output, 150);
    assert.equal(claudeSummary.total_cost_usd, 0.003);

    const geminiSummary = summary.find(s => s.agent === 'gemini-1.5');
    assert.ok(geminiSummary);
    assert.equal(geminiSummary.task_count, 1);
    assert.equal(geminiSummary.total_input, 300);
    assert.equal(geminiSummary.total_output, 150);
    assert.equal(geminiSummary.total_cost_usd, 0);

    // Verify totalCost
    const total = await env.tracker.totalCost();
    assert.equal(total.taskCount, 3);
    assert.equal(total.totalCost, 0.003);
  });
});
