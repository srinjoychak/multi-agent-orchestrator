import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskManager, MAX_DELEGATE_DEPTH } from './index.js';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_STATE_DIR = join(tmpdir(), `taskmanager-test-delegation-${Date.now()}`);

test('TaskManager Delegation', async (t) => {
  if (existsSync(TEST_STATE_DIR)) rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  mkdirSync(TEST_STATE_DIR, { recursive: true });

  const tm = new TaskManager(TEST_STATE_DIR);
  await tm.initialize();

  // Pre-register all jobs used across subtests (foreign key constraint on tasks.job_id)
  for (const [id, prompt] of [
    ['J1','job1'],['J2','job2'],['J3','job3'],['J4','job4'],
    ['J5','job5'],['J6','job6'],['J7','job7'],['J8','job8'],
  ]) tm.addJob(id, prompt);

  await t.test('createDelegatedTask sets correct fields', async () => {
    const parent = await tm.addTask({ title: 'Root Task', job_id: 'J1' });
    const child = await tm.createDelegatedTask(parent.id, { title: 'Child Task' });

    assert.equal(child.parent_task_id, parent.id);
    assert.equal(child.delegate_depth, 1);
    assert.equal(child.is_delegated, true);
    assert.equal(child.job_id, 'J1');
  });

  await t.test('createDelegatedTask fails if parent missing', async () => {
    await assert.rejects(
      tm.createDelegatedTask('NON_EXISTENT', { title: 'Child' }),
      /Task NON_EXISTENT not found/
    );
  });

  await t.test('createDelegatedTask enforces MAX_DELEGATE_DEPTH', async () => {
    let currentId = (await tm.addTask({ title: 'Root', job_id: 'J2' })).id;
    
    // Depth 1, 2, 3 should succeed
    for (let i = 1; i <= MAX_DELEGATE_DEPTH; i++) {
      const child = await tm.createDelegatedTask(currentId, { title: `Depth ${i}` });
      assert.equal(child.delegate_depth, i);
      currentId = child.id;
    }

    // Depth 4 should fail
    await assert.rejects(
      tm.createDelegatedTask(currentId, { title: 'Depth 4' }),
      /Maximum delegation depth \(3\) exceeded/
    );
  });

  await t.test('getDelegatedTasks returns only direct children', async () => {
    const p = await tm.addTask({ title: 'Parent', job_id: 'J3' });
    const c1 = await tm.createDelegatedTask(p.id, { title: 'C1' });
    const c2 = await tm.createDelegatedTask(p.id, { title: 'C2' });
    const gc1 = await tm.createDelegatedTask(c1.id, { title: 'GC1' });

    const delegated = await tm.getDelegatedTasks(p.id);
    assert.equal(delegated.length, 2);
    assert.ok(delegated.some(t => t.id === c1.id));
    assert.ok(delegated.some(t => t.id === c2.id));
    assert.ok(!delegated.some(t => t.id === gc1.id));
  });

  await t.test('getTaskTree returns full subtree', async () => {
    const p = await tm.addTask({ title: 'Root', job_id: 'J4' });
    const c1 = await tm.createDelegatedTask(p.id, { title: 'C1' });
    const gc1 = await tm.createDelegatedTask(c1.id, { title: 'GC1' });
    
    const tree = await tm.getTaskTree(p.id);
    assert.equal(tree.length, 3);
    assert.equal(tree[0].id, p.id);
    assert.equal(tree[1].id, c1.id);
    assert.equal(tree[2].id, gc1.id);
  });

  await t.test('orphan recovery: delegated in_progress tasks fail on restart', async () => {
    const p = await tm.addTask({ title: 'Parent', job_id: 'J5' });
    const child = await tm.createDelegatedTask(p.id, { title: 'Orphan' });
    
    // Manually set to in_progress
    tm.db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(child.id);
    
    tm.close();
    const tm2 = new TaskManager(TEST_STATE_DIR);
    await tm2.initialize();
    
    const recovered = await tm2.getTask(child.id);
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.routing_reason, 'orchestrator_restart');
    tm2.close();
    await tm.initialize();
  });

  await t.test('orphan recovery: non-delegated in_progress tasks are NOT failed', async () => {
    const normal = await tm.addTask({ title: 'Normal', job_id: 'J6' });
    tm.db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(normal.id);
    
    tm.close();
    const tm2 = new TaskManager(TEST_STATE_DIR);
    await tm2.initialize();
    
    const recovered = await tm2.getTask(normal.id);
    assert.equal(recovered.status, 'in_progress');
    tm2.close();
    await tm.initialize();
  });

  await t.test('getTaskTree maintains depth order', async () => {
    const r = await tm.addTask({ title: 'R', job_id: 'J7' });
    const c2 = await tm.createDelegatedTask(r.id, { title: 'C2' });
    const c1 = await tm.createDelegatedTask(r.id, { title: 'C1' });
    
    const tree = await tm.getTaskTree(r.id);
    assert.equal(tree[0].id, r.id);
    assert.equal(tree[1].id, c2.id);
    assert.equal(tree[2].id, c1.id);
  });

  await t.test('is_delegated is correctly persisted and retrieved', async () => {
    const p = await tm.addTask({ title: 'Root', job_id: 'J8' });
    const child = await tm.createDelegatedTask(p.id, { title: 'Delegated' });
    
    const retrieved = await tm.getTask(child.id);
    assert.strictEqual(retrieved.is_delegated, true);
    
    const nonDelegated = await tm.addTask({ title: 'Non-Delegated' });
    assert.strictEqual(nonDelegated.is_delegated, false);
  });

  tm.close();
  if (existsSync(TEST_STATE_DIR)) rmSync(TEST_STATE_DIR, { recursive: true, force: true });
});
