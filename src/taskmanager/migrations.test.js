/**
 * Idempotent migration tests for TaskManager.
 *
 * Run with: node --test src/taskmanager/migrations.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskManager } from './index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'taskmanager-test-'));
}

async function freshManager(dir) {
  const tm = new TaskManager(dir);
  await tm.initialize();
  return tm;
}

const NEW_COLUMNS = [
  'subagent_name', 'provider', 'model', 'parent_task_id',
  'delegate_depth', 'is_delegated', 'routing_reason', 'result_data',
];

// ─── Fresh database ───────────────────────────────────────────────────────────

test('fresh database initializes with all new columns', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    const cols = tm.db.pragma('table_info(tasks)').map(c => c.name);
    for (const col of NEW_COLUMNS) {
      assert.ok(cols.includes(col), `Column ${col} missing from fresh schema`);
    }
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fresh database has user_version = 1', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    const ver = tm.db.pragma('user_version', { simple: true });
    assert.equal(ver, 1);
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

test('second initialize() on same database does not throw', async () => {
  const dir = makeTempDir();
  try {
    const tm1 = await freshManager(dir);
    tm1.close();
    // Re-open and initialize again — must not throw "duplicate column" errors.
    const tm2 = await freshManager(dir);
    const ver = tm2.db.pragma('user_version', { simple: true });
    assert.equal(ver, 1);
    tm2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('calling initialize() 5 times is safe', async () => {
  const dir = makeTempDir();
  try {
    for (let i = 0; i < 5; i++) {
      const tm = await freshManager(dir);
      tm.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── v0 → v1 upgrade simulation ──────────────────────────────────────────────

test('v0 database (missing new columns) is migrated to v1 on startup', async () => {
  const dir = makeTempDir();
  try {
    // Bootstrap a v0 database manually — schema without new columns, user_version=0.
    const Database = (await import('better-sqlite3')).default;
    const dbPath = join(dir, 'tasks.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = DELETE');
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, prompt TEXT NOT NULL,
        status TEXT DEFAULT 'running', created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id),
        title TEXT NOT NULL, description TEXT,
        type TEXT DEFAULT 'code', status TEXT DEFAULT 'pending',
        queue TEXT DEFAULT 'pending', assigned_to TEXT,
        claimed_at TEXT, completed_at TEXT,
        depends_on TEXT DEFAULT '[]', result_ref TEXT,
        worktree_branch TEXT, container_id TEXT,
        retries INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 1,
        previous_agents TEXT DEFAULT '[]', token_usage TEXT DEFAULT '{}',
        forced_agent TEXT, retry_after TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // user_version stays 0 — simulates a pre-migration install.
    db.close();

    // Now open with TaskManager — migration should run.
    const tm = await freshManager(dir);
    const ver = tm.db.pragma('user_version', { simple: true });
    assert.equal(ver, 1, 'user_version should be 1 after migration');

    const cols = tm.db.pragma('table_info(tasks)').map(c => c.name);
    for (const col of NEW_COLUMNS) {
      assert.ok(cols.includes(col), `Column ${col} missing after v0→v1 migration`);
    }
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── New fields persist and round-trip correctly ──────────────────────────────

test('new fields are persisted and deserialized correctly', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTask({
      id: 'T1',
      job_id: 'J1',
      title: 'Research task',
      type: 'research',
      subagent_name: 'researcher',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      parent_task_id: null,
      delegate_depth: 0,
      is_delegated: false,
      routing_reason: 'quota_match',
    });

    const task = await tm.getTask('T1');
    assert.equal(task.subagent_name, 'researcher');
    assert.equal(task.provider, 'gemini');
    assert.equal(task.model, 'gemini-2.5-pro');
    assert.equal(task.parent_task_id, null);
    assert.equal(task.delegate_depth, 0);
    assert.equal(task.is_delegated, false);
    assert.equal(task.routing_reason, 'quota_match');
    assert.equal(task.result_data, null);
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('result_data is stored and retrieved as structured object', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTask({ id: 'T1', job_id: 'J1', title: 'Code task', type: 'code' });
    await tm.claimTask('T1', 'gemini');
    await tm.updateStatus('T1', 'in_progress');
    const resultData = {
      summary: 'Implemented rate limiter',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      files_changed: ['src/middleware/ratelimit.js'],
      commit_hash: 'abc123',
      duration_ms: 12000,
    };
    await tm.updateStatus('T1', 'done', { result_data: resultData });

    const task = await tm.getTask('T1');
    assert.deepEqual(task.result_data, resultData);
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is_delegated=true round-trips as boolean', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTask({
      id: 'T1', job_id: 'J1', title: 'Delegated task', type: 'research',
      is_delegated: true, parent_task_id: 'T0', delegate_depth: 1,
    });
    const task = await tm.getTask('T1');
    assert.equal(task.is_delegated, true, 'is_delegated should be boolean true');
    assert.equal(task.parent_task_id, 'T0');
    assert.equal(task.delegate_depth, 1);
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Orphan recovery ─────────────────────────────────────────────────────────

test('orphan recovery: is_delegated in_progress tasks are failed on startup', async () => {
  const dir = makeTempDir();
  try {
    const tm1 = await freshManager(dir);
    tm1.addJob('J1', 'test job');
    await tm1.addTask({
      id: 'T1', job_id: 'J1', title: 'Orphan task', type: 'code',
      is_delegated: true,
    });
    // Manually force the task into in_progress to simulate a crashed session.
    tm1.db.prepare(
      `UPDATE tasks SET status='in_progress', assigned_to='gemini' WHERE id='T1'`
    ).run();
    tm1.close();

    // Re-open — orphan recovery should fire.
    const tm2 = await freshManager(dir);
    const task = await tm2.getTask('T1');
    assert.equal(task.status, 'failed', 'Orphaned delegated task should be failed on restart');
    assert.equal(task.routing_reason, 'orchestrator_restart');
    tm2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orphan recovery: non-delegated in_progress tasks are NOT affected', async () => {
  const dir = makeTempDir();
  try {
    const tm1 = await freshManager(dir);
    tm1.addJob('J1', 'test job');
    await tm1.addTask({
      id: 'T1', job_id: 'J1', title: 'Regular task', type: 'code',
      is_delegated: false,
    });
    tm1.db.prepare(
      `UPDATE tasks SET status='in_progress', assigned_to='gemini' WHERE id='T1'`
    ).run();
    tm1.close();

    const tm2 = await freshManager(dir);
    const task = await tm2.getTask('T1');
    // resetStaleClaims handles claimed tasks, but in_progress non-delegated tasks
    // are NOT touched by orphan recovery — that is intentional.
    assert.equal(task.status, 'in_progress', 'Non-delegated in_progress task must not be touched by orphan recovery');
    tm2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Existing CRUD still works ────────────────────────────────────────────────

test('existing task state machine still works end-to-end', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTask({ id: 'T1', job_id: 'J1', title: 'Build feature', type: 'code' });

    let task = await tm.getTask('T1');
    assert.equal(task.status, 'pending');

    await tm.claimTask('T1', 'gemini');
    task = await tm.getTask('T1');
    assert.equal(task.status, 'claimed');
    assert.equal(task.assigned_to, 'gemini');

    await tm.updateStatus('T1', 'in_progress');
    task = await tm.getTask('T1');
    assert.equal(task.status, 'in_progress');

    await tm.updateStatus('T1', 'done', { result_ref: '/tmp/logs/T1.log' });
    task = await tm.getTask('T1');
    assert.equal(task.status, 'done');
    assert.equal(task.result_ref, '/tmp/logs/T1.log');

    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reject re-queues a done task as pending', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTask({ id: 'T1', job_id: 'J1', title: 'Build feature', type: 'code' });
    await tm.claimTask('T1', 'gemini');
    await tm.updateStatus('T1', 'in_progress');
    await tm.updateStatus('T1', 'done');

    await tm.rejectTask('T1', 'Missing tests');
    const task = await tm.getTask('T1');
    assert.equal(task.status, 'pending');
    assert.ok(task.description.includes('[REJECTED]'));
    assert.ok(Array.isArray(task.previous_agents));
    assert.ok(task.previous_agents.includes('gemini'));

    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed task auto-retries and excludes previous agent', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTask({ id: 'T1', job_id: 'J1', title: 'Build feature', type: 'code', max_retries: 2 });
    await tm.claimTask('T1', 'gemini');
    await tm.updateStatus('T1', 'in_progress');
    await tm.updateStatus('T1', 'failed');

    const task = await tm.getTask('T1');
    assert.equal(task.status, 'pending');
    assert.equal(task.queue, 'retry');
    assert.ok(task.previous_agents.includes('gemini'));

    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addTasks bulk insert with new fields works', async () => {
  const dir = makeTempDir();
  try {
    const tm = await freshManager(dir);
    tm.addJob('J1', 'test job');
    await tm.addTasks([
      { id: 'T1', job_id: 'J1', title: 'Task 1', type: 'code', subagent_name: 'implementer', provider: 'claude' },
      { id: 'T2', job_id: 'J1', title: 'Task 2', type: 'research', subagent_name: 'researcher', provider: 'gemini' },
    ]);
    const tasks = await tm.getJobTasks('J1');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].subagent_name, 'implementer');
    assert.equal(tasks[0].provider, 'claude');
    assert.equal(tasks[1].subagent_name, 'researcher');
    assert.equal(tasks[1].provider, 'gemini');
    tm.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
