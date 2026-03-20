import { describe, it, mock, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import {
  newSession,
  loadSession,
  saveSession,
  patchSession,
  recordReview,
} from '../session.js';
import { stepStatus } from './status.js';
import { stepExecute } from './execute.js';
import { stepMerge } from './merge.js';
import { stepDecompose } from './decompose.js';
import { stepAssign } from './assign.js';
import { ResultMerger } from '../../merger/index.js';
import { Orchestrator } from '../core.js';
import { TaskManager } from '../../taskmanager/index.js';

// ─── test helpers ─────────────────────────────────────────────────────────────

/** Create an isolated project root with .agent-team/ already set up. */
async function makeProjectDir({ session } = {}) {
  const root = join(tmpdir(), `step-test-${randomUUID()}`);
  const agentDir = join(root, '.agent-team');
  await mkdir(agentDir, { recursive: true });
  if (session) await saveSession(agentDir, session);
  return { root, agentDir };
}

function taskFixture(overrides = {}) {
  return {
    id: 'T1',
    title: 'Add auth middleware',
    type: 'code',
    status: 'done',
    assigned_to: 'claude-code',
    worktree_branch: 'agent/claude-code/T1',
    depends_on: [],
    retry_count: 0,
    max_retries: 3,
    created_at: new Date().toISOString(),
    claimed_at: null,
    completed_at: null,
    result_ref: null,
    summary: null,
    ...overrides,
  };
}

/** Silence all console output in a test. */
function silenceConsole() {
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
}

// ─── session helpers ──────────────────────────────────────────────────────────

describe('session helpers', () => {
  let agentDir;

  before(async () => {
    agentDir = join(tmpdir(), `session-test-${randomUUID()}`);
    await mkdir(agentDir, { recursive: true });
  });

  after(async () => {
    await rm(agentDir, { recursive: true, force: true });
  });

  it('newSession returns correct shape', () => {
    const s = newSession('/my/project', 'Build something');
    assert.ok(s.sessionId.startsWith('sess-'));
    assert.equal(s.projectRoot, '/my/project');
    assert.equal(s.prompt, 'Build something');
    assert.equal(s.phase, 'init');
    assert.deepEqual(s.reviews, {});
    assert.ok(s.createdAt);
    assert.ok(s.updatedAt);
  });

  it('saveSession then loadSession round-trips correctly', async () => {
    const s = newSession('/proj', 'Test prompt');
    await saveSession(agentDir, s);
    const loaded = await loadSession(agentDir);
    assert.equal(loaded.sessionId, s.sessionId);
    assert.equal(loaded.prompt, 'Test prompt');
    assert.equal(loaded.phase, 'init');
  });

  it('loadSession throws when no session file exists', async () => {
    const empty = join(tmpdir(), `no-sess-${randomUUID()}`);
    await mkdir(empty, { recursive: true });
    await assert.rejects(() => loadSession(empty), /No active session/);
    await rm(empty, { recursive: true, force: true });
  });

  it('patchSession updates specific fields only', async () => {
    const s = newSession('/proj', 'Original');
    await saveSession(agentDir, s);
    const patched = await patchSession(agentDir, { phase: 'assigned' });
    assert.equal(patched.phase, 'assigned');
    assert.equal(patched.prompt, 'Original');
    assert.equal(patched.sessionId, s.sessionId);
  });

  it('patchSession updates updatedAt timestamp', async () => {
    const s = newSession('/proj', 'Test');
    await saveSession(agentDir, s);
    await new Promise((r) => setTimeout(r, 5));
    const patched = await patchSession(agentDir, { phase: 'decomposed' });
    assert.ok(patched.updatedAt >= s.updatedAt);
  });

  it('recordReview saves accepted decision', async () => {
    const s = newSession('/proj', 'Test');
    await saveSession(agentDir, s);
    const updated = await recordReview(agentDir, 'T1', 'accepted');
    assert.equal(updated.reviews.T1.decision, 'accepted');
    assert.ok(updated.reviews.T1.at);
  });

  it('recordReview saves rejected decision with reason', async () => {
    const s = newSession('/proj', 'Test');
    await saveSession(agentDir, s);
    const updated = await recordReview(agentDir, 'T2', 'rejected', 'Missing tests');
    assert.equal(updated.reviews.T2.decision, 'rejected');
    assert.equal(updated.reviews.T2.reason, 'Missing tests');
  });

  it('recordReview preserves existing reviews', async () => {
    const s = newSession('/proj', 'Test');
    s.reviews = { T1: { decision: 'accepted', at: new Date().toISOString() } };
    await saveSession(agentDir, s);
    const updated = await recordReview(agentDir, 'T2', 'rejected', 'Bad');
    assert.ok(updated.reviews.T1);
    assert.ok(updated.reviews.T2);
  });
});

// ─── stepStatus ──────────────────────────────────────────────────────────────

describe('stepStatus()', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('returns null when no session exists', async () => {
    const { root } = await makeProjectDir();
    silenceConsole();
    const result = await stepStatus(root);
    assert.equal(result, null);
    await rm(root, { recursive: true, force: true });
  });

  it('prints "No active session" when no session exists', async () => {
    const { root } = await makeProjectDir();
    const logs = [];
    mock.method(console, 'log', (m) => logs.push(String(m ?? '')));
    await stepStatus(root);
    assert.ok(logs.some((l) => l.includes('No active session')));
    await rm(root, { recursive: true, force: true });
  });

  it('returns {session, tasks, summary} when session + tasks exist', async () => {
    const sess = newSession('/proj', 'Build a REST API');
    sess.phase = 'assigned';
    const { root } = await makeProjectDir({ session: sess });

    const tasks = [taskFixture()];
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => tasks);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 1, in_progress: 0, pending: 0, failed: 0,
    }));
    silenceConsole();

    const result = await stepStatus(root);

    assert.ok(result);
    assert.equal(result.session.sessionId, sess.sessionId);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.summary.done, 1);
    await rm(root, { recursive: true, force: true });
  });

  it('prints task ID in status board output', async () => {
    const sess = newSession('/proj', 'Build API');
    sess.phase = 'assigned';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ id: 'T42', title: 'My task' }),
    ]);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 1, in_progress: 0, pending: 0, failed: 0,
    }));

    const logs = [];
    mock.method(console, 'log', (m) => logs.push(String(m ?? '')));

    await stepStatus(root);
    assert.ok(logs.some((l) => l.includes('T42')));
    await rm(root, { recursive: true, force: true });
  });

  it('shows accepted review marker in output', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    sess.reviews = { T1: { decision: 'accepted', at: new Date().toISOString() } };
    const { root } = await makeProjectDir({ session: sess });

    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [taskFixture()]);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 1, in_progress: 0, pending: 0, failed: 0,
    }));

    const logs = [];
    mock.method(console, 'log', (m) => logs.push(String(m ?? '')));

    await stepStatus(root);
    assert.ok(logs.some((l) => l.includes('accepted')));
    await rm(root, { recursive: true, force: true });
  });

  it('shows rejected review marker in output', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    sess.reviews = {
      T1: { decision: 'rejected', reason: 'Bad code', at: new Date().toISOString() },
    };
    const { root } = await makeProjectDir({ session: sess });

    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [taskFixture()]);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 1, in_progress: 0, pending: 0, failed: 0,
    }));

    const logs = [];
    mock.method(console, 'log', (m) => logs.push(String(m ?? '')));

    await stepStatus(root);
    assert.ok(logs.some((l) => l.includes('rejected')));
    await rm(root, { recursive: true, force: true });
  });
});

// ─── stepExecute ─────────────────────────────────────────────────────────────

describe('stepExecute()', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('throws when session phase is incompatible', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'init';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});

    await assert.rejects(
      () => stepExecute(root),
      /Cannot execute in phase "init"/,
    );
    await rm(root, { recursive: true, force: true });
  });

  it('throws when specific taskId not found', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'assigned';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => []);

    await assert.rejects(
      () => stepExecute(root, 'T99'),
      /Task T99 not found/,
    );
    await rm(root, { recursive: true, force: true });
  });

  it('calls executeTasks() when no taskId given', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'assigned';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    const execMock = mock.method(Orchestrator.prototype, 'executeTasks', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [taskFixture({ status: 'done' })]);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 1, in_progress: 0, pending: 0, failed: 0,
    }));
    mock.method(TaskManager.prototype, 'isAllComplete', async () => true);
    silenceConsole();

    await stepExecute(root);

    assert.equal(execMock.mock.callCount(), 1);
    await rm(root, { recursive: true, force: true });
  });

  it('calls _runTask() when taskId is provided', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'assigned';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    const runMock = mock.method(Orchestrator.prototype, '_runTask', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ status: 'in_progress' }),
    ]);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 0, in_progress: 1, pending: 0, failed: 0,
    }));
    mock.method(TaskManager.prototype, 'isAllComplete', async () => false);
    silenceConsole();

    await stepExecute(root, 'T1');

    assert.equal(runMock.mock.callCount(), 1);
    assert.equal(runMock.mock.calls[0].arguments[0].id, 'T1');
    await rm(root, { recursive: true, force: true });
  });

  it('advances session to reviewing when all tasks complete', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'assigned';
    const { root, agentDir } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(Orchestrator.prototype, 'executeTasks', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [taskFixture({ status: 'done' })]);
    mock.method(TaskManager.prototype, 'getSummary', async () => ({
      done: 1, in_progress: 0, pending: 0, failed: 0,
    }));
    mock.method(TaskManager.prototype, 'isAllComplete', async () => true);
    silenceConsole();

    await stepExecute(root);

    const updated = await loadSession(agentDir);
    assert.equal(updated.phase, 'reviewing');
    await rm(root, { recursive: true, force: true });
  });
});

// ─── stepMerge ───────────────────────────────────────────────────────────────

describe('stepMerge()', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('reports no eligible tasks when all rejected', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    sess.reviews = { T1: { decision: 'rejected', at: new Date().toISOString() } };
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [taskFixture()]);

    const logs = [];
    mock.method(console, 'log', (m) => logs.push(String(m ?? '')));

    const result = await stepMerge(root);
    assert.equal(result.merged, 0);
    assert.ok(logs.some((l) => l.includes('No tasks eligible')));
    await rm(root, { recursive: true, force: true });
  });

  it('merges only accepted tasks in review mode', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    sess.reviews = {
      T1: { decision: 'accepted', at: new Date().toISOString() },
      T2: { decision: 'rejected', at: new Date().toISOString() },
    };
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ id: 'T1', worktree_branch: 'agent/claude-code/T1' }),
      taskFixture({ id: 'T2', worktree_branch: 'agent/gemini/T2', assigned_to: 'gemini' }),
    ]);
    mock.method(ResultMerger.prototype, 'mergeBranch',
      async () => ({ success: true, conflicts: [], output: 'ok' }),
    );
    silenceConsole();
    mock.method(process.stdout, 'write', () => {});

    const result = await stepMerge(root);
    assert.equal(result.merged, 1); // T1 only
    assert.equal(result.conflicted, 0);
    await rm(root, { recursive: true, force: true });
  });

  it('auto-merges all done tasks when no reviews recorded', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'executing';
    const { root, agentDir } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ id: 'T1', worktree_branch: 'agent/claude-code/T1' }),
      taskFixture({ id: 'T2', worktree_branch: 'agent/gemini/T2', assigned_to: 'gemini' }),
    ]);
    mock.method(ResultMerger.prototype, 'mergeBranch',
      async () => ({ success: true, conflicts: [], output: 'ok' }),
    );
    silenceConsole();
    mock.method(process.stdout, 'write', () => {});

    const result = await stepMerge(root);
    assert.equal(result.merged, 2);
    assert.equal(result.conflicted, 0);

    const updated = await loadSession(agentDir);
    assert.equal(updated.phase, 'merged');
    await rm(root, { recursive: true, force: true });
  });

  it('throws when specific taskId is not found', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => []);

    await assert.rejects(
      () => stepMerge(root, 'T99'),
      /Task T99 not found/,
    );
    await rm(root, { recursive: true, force: true });
  });

  it('throws when specific task is not done', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ status: 'in_progress' }),
    ]);

    await assert.rejects(
      () => stepMerge(root, 'T1'),
      /not done/,
    );
    await rm(root, { recursive: true, force: true });
  });

  it('returns conflict count without throwing on merge conflict', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'reviewing';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [taskFixture()]);
    mock.method(ResultMerger.prototype, 'mergeBranch',
      async () => ({ success: false, conflicts: ['src/api.js'], output: 'CONFLICT' }),
    );
    silenceConsole();
    mock.method(process.stdout, 'write', () => {});

    const result = await stepMerge(root, 'T1');
    assert.equal(result.conflicted, 1);
    assert.equal(result.merged, 0);
    await rm(root, { recursive: true, force: true });
  });
});

// ─── stepDecompose (validation only) ─────────────────────────────────────────

describe('stepDecompose() validation', () => {
  it('throws when prompt is empty string', async () => {
    await assert.rejects(() => stepDecompose('/tmp', ''), /requires a prompt/);
  });

  it('throws when prompt is whitespace only', async () => {
    await assert.rejects(() => stepDecompose('/tmp', '   '), /requires a prompt/);
  });
});

// ─── stepAssign (phase validation + no-pending) ───────────────────────────────

describe('stepAssign() validation', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('throws when session phase is incompatible', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'executing';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});

    await assert.rejects(
      () => stepAssign(root),
      /Cannot assign in phase/,
    );
    await rm(root, { recursive: true, force: true });
  });

  it('returns empty array when no pending tasks exist', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'decomposed';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ status: 'in_progress' }),
    ]);
    silenceConsole();

    const result = await stepAssign(root);
    assert.deepEqual(result, []);
    await rm(root, { recursive: true, force: true });
  });

  it('prints "No pending tasks" when all already assigned', async () => {
    const sess = newSession('/proj', 'Test');
    sess.phase = 'decomposed';
    const { root } = await makeProjectDir({ session: sess });

    mock.method(Orchestrator.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'initialize', async () => {});
    mock.method(TaskManager.prototype, 'getTasks', async () => [
      taskFixture({ status: 'in_progress' }),
    ]);

    const logs = [];
    mock.method(console, 'log', (m) => logs.push(String(m ?? '')));

    await stepAssign(root);
    assert.ok(logs.some((l) => l.includes('No pending tasks')));
    await rm(root, { recursive: true, force: true });
  });
});
