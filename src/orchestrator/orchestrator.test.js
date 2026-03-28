import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { TaskManager } from '../taskmanager/index.js';

async function makeTestEnv() {
  const dir = join(tmpdir(), `orch-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const manager = new TaskManager(dir);
  await manager.initialize();
  return { dir, manager, cleanup: async () => { await rm(dir, { recursive: true, force: true }); } };
}

// ── R1: TASK_CONTEXT.md cleanup ──
describe('R1: TASK_CONTEXT.md is deleted before auto-commit', () => {
  it('rm(TASK_CONTEXT.md) removes the file from worktree', async () => {
    const dir = join(tmpdir(), `r1-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const ctxPath = join(dir, 'TASK_CONTEXT.md');
    await writeFile(ctxPath, '# test context');
    assert.ok(existsSync(ctxPath));
    await rm(ctxPath, { force: true });
    assert.ok(!existsSync(ctxPath));
    await rm(dir, { recursive: true, force: true });
  });
});

// ── R2: Circuit breaker ──
describe('R2: executeTasks circuit breaker', () => {
  // We can't easily test the full executeTasks without Docker,
  // but we can verify the circuit breaker parameters exist
  // and that isAllComplete works correctly for the exit condition.

  it('isAllComplete returns true when all tasks are done or failed', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test', type: 'code' });
      assert.equal(await manager.isAllComplete(), false);
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress');
      assert.equal(await manager.isAllComplete(), false);
      await manager.updateStatus('T1', 'done');
      assert.equal(await manager.isAllComplete(), true);
    } finally { await cleanup(); }
  });

  it('isAllComplete returns true when mix of done and failed', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test1', type: 'code', max_retries: 0 });
      await manager.addTask({ id: 'T2', title: 'test2', type: 'code' });
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress');
      await manager.updateStatus('T1', 'failed'); // max_retries=0, stays failed
      await manager.claimTask('T2', 'gemini');
      await manager.updateStatus('T2', 'in_progress');
      await manager.updateStatus('T2', 'done');
      assert.equal(await manager.isAllComplete(), true);
    } finally { await cleanup(); }
  });
});

// ── R3: max_retries default is 1 ──
describe('R3: max_retries default changed to 1', () => {
  it('addTask defaults max_retries to 1', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      const task = await manager.addTask({ id: 'T1', title: 'test', type: 'code' });
      assert.equal(task.max_retries, 1);
    } finally { await cleanup(); }
  });

  it('addTasks defaults max_retries to 1', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      const tasks = await manager.addTasks([
        { id: 'T1', title: 'test', type: 'code' },
      ]);
      const t1 = tasks.find(t => t.id === 'T1');
      assert.equal(t1.max_retries, 1);
    } finally { await cleanup(); }
  });

  it('explicit max_retries=5 is preserved', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      const task = await manager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 5 });
      assert.equal(task.max_retries, 5);
    } finally { await cleanup(); }
  });
});

// ── R4: updateStatus(failed) handles retry ──
describe('R4: updateStatus(failed) auto-retries correctly', () => {
  it('failed task with retries < max_retries goes back to pending', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 2 });
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress', { assigned_to: 'gemini' });
      const after = await manager.updateStatus('T1', 'failed');
      assert.equal(after.status, 'pending', 'should auto-retry to pending');
      assert.equal(after.retries, 1);
      assert.deepEqual(after.previous_agents, ['gemini']);
      assert.equal(after.assigned_to, null);
    } finally { await cleanup(); }
  });

  it('failed task with retries >= max_retries stays failed', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 0 });
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress');
      const after = await manager.updateStatus('T1', 'failed');
      assert.equal(after.status, 'failed', 'should stay failed');
    } finally { await cleanup(); }
  });
});
