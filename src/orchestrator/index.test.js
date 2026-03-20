/**
 * Tests for src/orchestrator/index.js CLI verb router.
 *
 * Strategy: index.js exports `_handlers` — a plain object that holds the step
 * function references. mock.method() replaces properties on that object so
 * main() dispatches to our stubs instead of the real implementations.
 *
 * TaskManager instance methods are mocked via mock.method on the prototype.
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _handlers, main } from './index.js';
import { TaskManager } from '../taskmanager/index.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

const originalArgv = process.argv.slice();

function setArgv(...args) {
  process.argv = ['node', 'index.js', ...args];
}

function restoreArgv() {
  process.argv = originalArgv.slice();
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('CLI verb router (index.js)', () => {
  afterEach(() => {
    restoreArgv();
    mock.restoreAll();
  });

  // ── --version ────────────────────────────────────────────────────────────────

  it('--version prints version string and exits 0', async () => {
    const exitCalls = [];
    mock.method(process, 'exit', (code) => exitCalls.push(code));
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(String(msg)));

    setArgv('--version');
    await main();

    assert.ok(logs.some((l) => /v\d+\.\d+/.test(l)), 'version number in output');
    assert.ok(exitCalls.includes(0), 'exits with code 0');
  });

  it('-v is alias for --version', async () => {
    const exitCalls = [];
    mock.method(process, 'exit', (code) => exitCalls.push(code));
    mock.method(console, 'log', () => {});

    setArgv('-v');
    await main();

    assert.ok(exitCalls.includes(0));
  });

  // ── --help / no args ─────────────────────────────────────────────────────────

  it('--help prints help text and exits 0', async () => {
    const exitCalls = [];
    mock.method(process, 'exit', (code) => exitCalls.push(code));
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(String(msg)));

    setArgv('--help');
    await main();

    const output = logs.join('\n');
    assert.match(output, /decompose/i);
    assert.match(output, /assign/i);
    assert.match(output, /execute/i);
    assert.ok(exitCalls.includes(0));
  });

  it('no args prints help and exits 0', async () => {
    const exitCalls = [];
    mock.method(process, 'exit', (code) => exitCalls.push(code));
    mock.method(console, 'log', () => {});

    setArgv();
    await main();

    assert.ok(exitCalls.includes(0));
  });

  // ── decompose ─────────────────────────────────────────────────────────────────

  it('decompose verb calls stepDecompose with projectRoot and prompt', async () => {
    const stub = mock.method(_handlers, 'stepDecompose', async () => {});

    setArgv('decompose', 'Build a REST API with auth');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [root, prompt] = stub.mock.calls[0].arguments;
    assert.equal(typeof root, 'string');
    assert.equal(prompt, 'Build a REST API with auth');
  });

  it('decompose joins multiple prompt words', async () => {
    const stub = mock.method(_handlers, 'stepDecompose', async () => {});

    setArgv('decompose', 'word1', 'word2', 'word3');
    await main();

    const [, prompt] = stub.mock.calls[0].arguments;
    assert.equal(prompt, 'word1 word2 word3');
  });

  // ── assign ────────────────────────────────────────────────────────────────────

  it('assign verb calls stepAssign with projectRoot', async () => {
    const stub = mock.method(_handlers, 'stepAssign', async () => {});

    setArgv('assign');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [root] = stub.mock.calls[0].arguments;
    assert.equal(typeof root, 'string');
  });

  // ── execute ───────────────────────────────────────────────────────────────────

  it('execute verb calls stepExecute with no taskId', async () => {
    const stub = mock.method(_handlers, 'stepExecute', async () => {});

    setArgv('execute');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [root, taskId] = stub.mock.calls[0].arguments;
    assert.equal(typeof root, 'string');
    assert.equal(taskId, undefined);
  });

  it('execute T1 calls stepExecute with taskId T1', async () => {
    const stub = mock.method(_handlers, 'stepExecute', async () => {});

    setArgv('execute', 'T1');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [, taskId] = stub.mock.calls[0].arguments;
    assert.equal(taskId, 'T1');
  });

  // ── status ────────────────────────────────────────────────────────────────────

  it('status verb calls stepStatus with projectRoot', async () => {
    const stub = mock.method(_handlers, 'stepStatus', async () => {});

    setArgv('status');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [root] = stub.mock.calls[0].arguments;
    assert.equal(typeof root, 'string');
  });

  // ── accept ────────────────────────────────────────────────────────────────────

  it('accept T1 calls recordReview with accepted', async () => {
    mock.method(console, 'log', () => {});
    const reviewStub = mock.method(
      _handlers, 'recordReview',
      async () => ({ phase: 'reviewing', reviews: {} }),
    );
    mock.method(_handlers, 'patchSession', async () => {});

    setArgv('accept', 'T1');
    await main();

    assert.equal(reviewStub.mock.callCount(), 1);
    const [, taskId, decision] = reviewStub.mock.calls[0].arguments;
    assert.equal(taskId, 'T1');
    assert.equal(decision, 'accepted');
  });

  it('accept without taskId throws', async () => {
    setArgv('accept');
    await assert.rejects(() => main(), /accept requires a task ID/);
  });

  // ── reject ────────────────────────────────────────────────────────────────────

  it('reject T2 reason calls recordReview with rejected', async () => {
    mock.method(console, 'log', () => {});
    const reviewStub = mock.method(
      _handlers, 'recordReview',
      async () => ({ phase: 'reviewing', reviews: {} }),
    );
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTask', async () => ({
      id: 'T2', description: 'Original', status: 'done',
    }));
    mock.method(TaskManager.prototype, 'updateStatus', async () => {});

    setArgv('reject', 'T2', 'Missing error handling');
    await main();

    assert.equal(reviewStub.mock.callCount(), 1);
    const [, taskId, decision, reason] = reviewStub.mock.calls[0].arguments;
    assert.equal(taskId, 'T2');
    assert.equal(decision, 'rejected');
    assert.equal(reason, 'Missing error handling');
  });

  it('reject re-queues task via updateStatus to pending', async () => {
    mock.method(console, 'log', () => {});
    mock.method(_handlers, 'recordReview', async () => ({}));
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTask', async () => ({
      id: 'T2', description: 'Original', status: 'done',
    }));
    const updateStub = mock.method(TaskManager.prototype, 'updateStatus', async () => {});

    setArgv('reject', 'T2', 'Bad output');
    await main();

    assert.equal(updateStub.mock.callCount(), 1);
    const [taskId, status] = updateStub.mock.calls[0].arguments;
    assert.equal(taskId, 'T2');
    assert.equal(status, 'pending');
  });

  it('reject appends reason to task description', async () => {
    mock.method(console, 'log', () => {});
    mock.method(_handlers, 'recordReview', async () => ({}));
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTask', async () => ({
      id: 'T2', description: 'Original description', status: 'done',
    }));
    const updateStub = mock.method(TaskManager.prototype, 'updateStatus', async () => {});

    setArgv('reject', 'T2', 'Bad output');
    await main();

    const [, , updates] = updateStub.mock.calls[0].arguments;
    assert.match(updates.description, /\[Rejected: Bad output\]/);
    assert.match(updates.description, /Original description/);
  });

  it('reject without taskId throws', async () => {
    setArgv('reject');
    await assert.rejects(() => main(), /reject requires a task ID/);
  });

  // ── merge ─────────────────────────────────────────────────────────────────────

  it('merge verb calls stepMerge with no taskId', async () => {
    const stub = mock.method(_handlers, 'stepMerge', async () => {});

    setArgv('merge');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [root, taskId] = stub.mock.calls[0].arguments;
    assert.equal(typeof root, 'string');
    assert.equal(taskId, undefined);
  });

  it('merge T1 calls stepMerge with taskId T1', async () => {
    const stub = mock.method(_handlers, 'stepMerge', async () => {});

    setArgv('merge', 'T1');
    await main();

    assert.equal(stub.mock.callCount(), 1);
    const [, taskId] = stub.mock.calls[0].arguments;
    assert.equal(taskId, 'T1');
  });
});
