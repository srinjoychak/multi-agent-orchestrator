import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeTmpDir } from './helpers.js';
import { TaskManager } from '../../src/taskmanager/index.js';

describe('TaskManager Integration Tests', () => {

  test('Full lifecycle: add → claim → progress → done', async (t) => {
    const env = await makeTmpDir();
    try {
      const tm = new TaskManager(env.path);
      await tm.initialize();

      // add
      const task = await tm.addTask({ id: 'T1', title: 'Task 1' });
      assert.strictEqual(task.status, 'pending');

      // claim
      const claimed = await tm.claimTask('T1', 'agent-1');
      assert.strictEqual(claimed.status, 'claimed');
      assert.strictEqual(claimed.assigned_to, 'agent-1');

      // progress
      const inProgress = await tm.updateStatus('T1', 'in_progress');
      assert.strictEqual(inProgress.status, 'in_progress');

      // done
      const done = await tm.updateStatus('T1', 'done');
      assert.strictEqual(done.status, 'done');
      assert.ok(done.completed_at);

      // summary
      const summary = await tm.getSummary();
      assert.strictEqual(summary.total, 1);
      assert.strictEqual(summary.done, 1);
      
      // isAllComplete
      assert.strictEqual(await tm.isAllComplete(), true);
    } finally {
      await env.cleanup();
    }
  });

});
