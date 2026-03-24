import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { TaskManager } from './index.js';
import { createTask, isValidTransition, VALID_TRANSITIONS } from '../types/index.js';

/**
 * Create a fresh isolated temp directory for a test suite.
 * Returns { dir, manager, cleanup }.
 */
async function makeTestEnv() {
  const dir = join(tmpdir(), `tm-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const manager = new TaskManager(dir);
  await manager.initialize();
  return {
    dir,
    manager,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// createTask() defaults
// ---------------------------------------------------------------------------
describe('createTask() defaults from types/index.js', () => {
  it('produces a task with correct default values', () => {
    const task = createTask({ id: 'T1', title: 'Hello' });
    assert.equal(task.id, 'T1');
    assert.equal(task.title, 'Hello');
    assert.equal(task.status, 'pending');
    assert.equal(task.assigned_to, null);
    assert.equal(task.claimed_at, null);
    assert.equal(task.completed_at, null);
    assert.deepEqual(task.depends_on, []);
    assert.equal(task.result_ref, null);
    assert.equal(task.worktree_branch, null);
    assert.equal(task.retries, 0);
    assert.equal(task.max_retries, 3);
    assert.deepEqual(task.previous_agents, []);
  });
});

// ---------------------------------------------------------------------------
// isValidTransition() — all valid and invalid cases
// ---------------------------------------------------------------------------
describe('isValidTransition()', () => {
  // Build valid pairs from VALID_TRANSITIONS
  for (const [from, tos] of Object.entries(VALID_TRANSITIONS)) {
    for (const to of tos) {
      it(`valid: ${from} → ${to}`, () => {
        assert.ok(isValidTransition(from, to));
      });
    }
  }

  it('invalid: pending → done', () => assert.equal(isValidTransition('pending', 'done'), false));
  it('invalid: pending → failed', () => assert.equal(isValidTransition('pending', 'failed'), false));
  it('invalid: pending → in_progress', () => assert.equal(isValidTransition('pending', 'in_progress'), false));
  it('valid: done → pending (reject re-queue)', () => assert.equal(isValidTransition('done', 'pending'), true));
  it('invalid: done → claimed', () => assert.equal(isValidTransition('done', 'claimed'), false));
  it('valid: in_progress → pending (reject re-queue)', () => assert.equal(isValidTransition('in_progress', 'pending'), true));
  it('invalid: in_progress → claimed', () => assert.equal(isValidTransition('in_progress', 'claimed'), false));
  it('invalid: failed → done', () => assert.equal(isValidTransition('failed', 'done'), false));
  it('invalid: unknown → pending', () => assert.equal(isValidTransition('unknown', 'pending'), false));
});

// ---------------------------------------------------------------------------
// TaskManager.addTask()
// ---------------------------------------------------------------------------
describe('TaskManager.addTask()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('creates task with correct defaults', async () => {
    const task = await env.manager.addTask({ id: 'T1', title: 'Test task' });
    assert.equal(task.id, 'T1');
    assert.equal(task.title, 'Test task');
    assert.equal(task.status, 'pending');
    assert.equal(task.retries, 0);
    assert.equal(task.max_retries, 3);
    assert.equal(task.assigned_to, null);
    assert.deepEqual(task.depends_on, []);
  });

  it('persists the task to disk', async () => {
    const tasks = await env.manager.getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 'T1');
  });
});

// ---------------------------------------------------------------------------
// TaskManager.claimTask()
// ---------------------------------------------------------------------------
describe('TaskManager.claimTask() success', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    await env.manager.addTask({ id: 'T1', title: 'A' });
  });
  after(async () => { await env.cleanup(); });

  it('sets status to claimed, assigns agent, sets claimed_at', async () => {
    const before = Date.now();
    const task = await env.manager.claimTask('T1', 'claude-code');
    assert.equal(task.status, 'claimed');
    assert.equal(task.assigned_to, 'claude-code');
    assert.ok(task.claimed_at);
    const claimedAt = new Date(task.claimed_at).getTime();
    assert.ok(claimedAt >= before);
    assert.ok(claimedAt <= Date.now());
  });
});

describe('TaskManager.claimTask() fails on already-claimed task', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    await env.manager.addTask({ id: 'T1', title: 'A' });
    await env.manager.claimTask('T1', 'claude-code');
  });
  after(async () => { await env.cleanup(); });

  it('throws when task is already claimed', async () => {
    await assert.rejects(
      () => env.manager.claimTask('T1', 'gemini'),
      (err) => {
        assert.ok(err.message.includes('claimed'));
        return true;
      },
    );
  });
});

describe('TaskManager.claimTask() fails on blocked task', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    // T1 is a dependency, T2 depends on T1
    await env.manager.addTask({ id: 'T1', title: 'Parent' });
    await env.manager.addTask({ id: 'T2', title: 'Child', depends_on: ['T1'] });
  });
  after(async () => { await env.cleanup(); });

  it('throws when dependency task is not done', async () => {
    await assert.rejects(
      () => env.manager.claimTask('T2', 'claude-code'),
      (err) => {
        assert.ok(err.message.includes('blocked'));
        return true;
      },
    );
  });

  it('allows claim when dependency is done', async () => {
    // Bring T1 to done: claim → in_progress → done
    await env.manager.claimTask('T1', 'claude-code');
    await env.manager.updateStatus('T1', 'in_progress');
    await env.manager.updateStatus('T1', 'done');

    const task = await env.manager.claimTask('T2', 'gemini');
    assert.equal(task.status, 'claimed');
  });
});

// ---------------------------------------------------------------------------
// TaskManager.updateStatus()
// ---------------------------------------------------------------------------
describe('TaskManager.updateStatus() valid transitions', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    await env.manager.addTask({ id: 'T1', title: 'A' });
    await env.manager.claimTask('T1', 'claude-code');
  });
  after(async () => { await env.cleanup(); });

  it('claimed → in_progress succeeds', async () => {
    const task = await env.manager.updateStatus('T1', 'in_progress');
    assert.equal(task.status, 'in_progress');
  });

  it('in_progress → done succeeds and sets completed_at', async () => {
    const task = await env.manager.updateStatus('T1', 'done');
    assert.equal(task.status, 'done');
    assert.ok(task.completed_at);
  });
});

describe('TaskManager.updateStatus() invalid transition throws', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    await env.manager.addTask({ id: 'T1', title: 'A' });
  });
  after(async () => { await env.cleanup(); });

  it('pending → done throws', async () => {
    await assert.rejects(
      () => env.manager.updateStatus('T1', 'done'),
      (err) => {
        assert.ok(err.message.includes('Invalid transition'));
        return true;
      },
    );
  });
});

describe('TaskManager.updateStatus() auto-retry on failure', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    // max_retries=1 so first failure triggers auto-retry
    await env.manager.addTask({ id: 'T1', title: 'A', max_retries: 1 });
    await env.manager.claimTask('T1', 'claude-code');
    await env.manager.updateStatus('T1', 'in_progress');
  });
  after(async () => { await env.cleanup(); });

  it('resets to pending and increments retries when retries < max_retries', async () => {
    const task = await env.manager.updateStatus('T1', 'failed');
    assert.equal(task.status, 'pending');
    assert.equal(task.retries, 1);
    assert.equal(task.assigned_to, null);
    assert.equal(task.claimed_at, null);
    assert.equal(task.completed_at, null);
  });

  it('stays failed when retries >= max_retries', async () => {
    // Now retries=1, max_retries=1 — next failure should NOT auto-retry
    const t = await env.manager.claimTask('T1', 'claude-code');
    await env.manager.updateStatus('T1', 'in_progress');
    const task = await env.manager.updateStatus('T1', 'failed');
    assert.equal(task.status, 'failed');
    assert.equal(task.retries, 1); // retries not incremented past max
  });
});

// ---------------------------------------------------------------------------
// TaskManager.getClaimableTasks()
// ---------------------------------------------------------------------------
describe('TaskManager.getClaimableTasks()', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    // T1: pending, no deps — claimable
    await env.manager.addTask({ id: 'T1', title: 'A' });
    // T2: pending, depends on T1 — blocked
    await env.manager.addTask({ id: 'T2', title: 'B', depends_on: ['T1'] });
    // T3: already claimed — not claimable
    await env.manager.addTask({ id: 'T3', title: 'C' });
    await env.manager.claimTask('T3', 'gemini');
  });
  after(async () => { await env.cleanup(); });

  it('returns only pending unblocked tasks', async () => {
    const claimable = await env.manager.getClaimableTasks();
    const ids = claimable.map((t) => t.id);
    assert.deepEqual(ids, ['T1']);
  });

  it('excludes blocked tasks', async () => {
    const claimable = await env.manager.getClaimableTasks();
    assert.ok(!claimable.find((t) => t.id === 'T2'));
  });

  it('excludes non-pending tasks', async () => {
    const claimable = await env.manager.getClaimableTasks();
    assert.ok(!claimable.find((t) => t.id === 'T3'));
  });
});

// ---------------------------------------------------------------------------
// TaskManager.getSummary()
// ---------------------------------------------------------------------------
describe('TaskManager.getSummary()', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    await env.manager.addTask({ id: 'T1', title: 'A' });             // pending
    await env.manager.addTask({ id: 'T2', title: 'B' });             // claimed
    await env.manager.addTask({ id: 'T3', title: 'C' });             // in_progress
    await env.manager.addTask({ id: 'T4', title: 'D' });             // done
    await env.manager.addTask({ id: 'T5', title: 'E', max_retries: 0 }); // failed (perm)

    await env.manager.claimTask('T2', 'claude-code');

    await env.manager.claimTask('T3', 'claude-code');
    await env.manager.updateStatus('T3', 'in_progress');

    await env.manager.claimTask('T4', 'claude-code');
    await env.manager.updateStatus('T4', 'in_progress');
    await env.manager.updateStatus('T4', 'done');

    await env.manager.claimTask('T5', 'claude-code');
    await env.manager.updateStatus('T5', 'in_progress');
    await env.manager.updateStatus('T5', 'failed'); // max_retries=0 so stays failed
  });
  after(async () => { await env.cleanup(); });

  it('returns correct counts', async () => {
    const summary = await env.manager.getSummary();
    assert.equal(summary.total, 5);
    assert.equal(summary.pending, 1);
    assert.equal(summary.claimed, 1);
    assert.equal(summary.in_progress, 1);
    assert.equal(summary.done, 1);
    assert.equal(summary.failed, 1);
  });
});

// ---------------------------------------------------------------------------
// TaskManager.isAllComplete()
// ---------------------------------------------------------------------------
describe('TaskManager.isAllComplete()', () => {
  it('returns false when tasks are pending', async () => {
    const env = await makeTestEnv();
    try {
      await env.manager.addTask({ id: 'T1', title: 'A' });
      assert.equal(await env.manager.isAllComplete(), false);
    } finally {
      await env.cleanup();
    }
  });

  it('returns true when all tasks are done', async () => {
    const env = await makeTestEnv();
    try {
      await env.manager.addTask({ id: 'T1', title: 'A' });
      await env.manager.claimTask('T1', 'agent');
      await env.manager.updateStatus('T1', 'in_progress');
      await env.manager.updateStatus('T1', 'done');
      assert.equal(await env.manager.isAllComplete(), true);
    } finally {
      await env.cleanup();
    }
  });

  it('returns true when all tasks are permanently failed', async () => {
    const env = await makeTestEnv();
    try {
      await env.manager.addTask({ id: 'T1', title: 'A', max_retries: 0 });
      await env.manager.claimTask('T1', 'agent');
      await env.manager.updateStatus('T1', 'in_progress');
      await env.manager.updateStatus('T1', 'failed');
      assert.equal(await env.manager.isAllComplete(), true);
    } finally {
      await env.cleanup();
    }
  });

  it('returns false when a task is in_progress', async () => {
    const env = await makeTestEnv();
    try {
      await env.manager.addTask({ id: 'T1', title: 'A' });
      await env.manager.claimTask('T1', 'agent');
      await env.manager.updateStatus('T1', 'in_progress');
      assert.equal(await env.manager.isAllComplete(), false);
    } finally {
      await env.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// TaskManager.getTasksByAgent()
// ---------------------------------------------------------------------------
describe('TaskManager.getTasksByAgent()', () => {
  let env;
  before(async () => {
    env = await makeTestEnv();
    await env.manager.addTask({ id: 'T1', title: 'A' });
    await env.manager.addTask({ id: 'T2', title: 'B' });
    await env.manager.addTask({ id: 'T3', title: 'C' });
    await env.manager.claimTask('T1', 'claude-code');
    await env.manager.claimTask('T2', 'gemini');
    await env.manager.claimTask('T3', 'claude-code');
  });
  after(async () => { await env.cleanup(); });

  it('returns tasks assigned to the specified agent', async () => {
    const tasks = await env.manager.getTasksByAgent('claude-code');
    const ids = tasks.map((t) => t.id).sort();
    assert.deepEqual(ids, ['T1', 'T3']);
  });

  it('returns different tasks for another agent', async () => {
    const tasks = await env.manager.getTasksByAgent('gemini');
    const ids = tasks.map((t) => t.id);
    assert.deepEqual(ids, ['T2']);
  });

  it('returns empty array for unknown agent', async () => {
    const tasks = await env.manager.getTasksByAgent('unknown-agent');
    assert.deepEqual(tasks, []);
  });
});

// ---------------------------------------------------------------------------
// TaskManager.resetStaleClaims()
// ---------------------------------------------------------------------------
describe('TaskManager.resetStaleClaims()', () => {
  it('resets tasks claimed more than 10 minutes ago', async () => {
    const env = await makeTestEnv();
    try {
      await env.manager.addTask({ id: 'T1', title: 'Stale' });
      await env.manager.claimTask('T1', 'claude-code');

      // Manually backdate claimed_at by 11 minutes
      const staleTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      await env.manager._withLock(async (tasks) => {
        const t = tasks.find((t) => t.id === 'T1');
        t.claimed_at = staleTime;
        return null;
      });

      const reset = await env.manager.resetStaleClaims();
      assert.deepEqual(reset, ['T1']);

      const task = await env.manager.getTask('T1');
      assert.equal(task.status, 'pending');
      assert.equal(task.assigned_to, null);
      assert.equal(task.claimed_at, null);
    } finally {
      await env.cleanup();
    }
  });

  it('does not reset tasks claimed less than 10 minutes ago', async () => {
    const env = await makeTestEnv();
    try {
      await env.manager.addTask({ id: 'T1', title: 'Fresh' });
      await env.manager.claimTask('T1', 'claude-code');

      const reset = await env.manager.resetStaleClaims();
      assert.deepEqual(reset, []);

      const task = await env.manager.getTask('T1');
      assert.equal(task.status, 'claimed');
    } finally {
      await env.cleanup();
    }
  });
});
