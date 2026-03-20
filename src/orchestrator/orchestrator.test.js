import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from './index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';

describe('Orchestrator', () => {
  const orchestrator = new Orchestrator('/tmp/test-project');

  afterEach(() => {
    mock.restoreAll();
  });

  describe('_getReadyTasks()', () => {
    it('returns only pending tasks with all depends_on met', () => {
      const tasks = [
        { id: 'T1', status: 'done', depends_on: [] },
        { id: 'T2', status: 'pending', depends_on: ['T1'] }, // Ready
        { id: 'T3', status: 'pending', depends_on: ['T4'] }, // Blocked
        { id: 'T4', status: 'pending', depends_on: [] },    // Ready
        { id: 'T5', status: 'in_progress', depends_on: [] }  // Not pending
      ];

      const ready = orchestrator._getReadyTasks(tasks);
      const ids = ready.map(t => t.id).sort();
      assert.deepEqual(ids, ['T2', 'T4']);
    });

    it('returns all pending tasks when no dependencies exist', () => {
      const tasks = [
        { id: 'T1', status: 'pending', depends_on: [] },
        { id: 'T2', status: 'pending', depends_on: [] }
      ];
      const ready = orchestrator._getReadyTasks(tasks);
      assert.equal(ready.length, 2);
    });
  });

  describe('_handleFailedDependencies()', () => {
    it('marks pending tasks as failed when a dependency has failed', async () => {
      const tasks = [
        { id: 'T1', status: 'failed', depends_on: [] },
        { id: 'T2', status: 'pending', depends_on: ['T1'] }
      ];

      const updateMock = mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));
      
      await orchestrator._handleFailedDependencies(tasks);
      
      assert.equal(updateMock.mock.callCount(), 1);
      const [id, status, updates] = updateMock.mock.calls[0].arguments;
      assert.equal(id, 'T2');
      assert.equal(status, 'failed');
      assert.match(updates.summary, /dependency T1 failed/);
    });

    it('does not mark tasks whose dependencies are done', async () => {
      const tasks = [
        { id: 'T1', status: 'done', depends_on: [] },
        { id: 'T2', status: 'pending', depends_on: ['T1'] }
      ];

      const updateMock = mock.method(orchestrator.taskManager, 'updateStatus');
      await orchestrator._handleFailedDependencies(tasks);
      assert.equal(updateMock.mock.callCount(), 0);
    });
  });

  describe('loadTasksFromFile()', () => {
    const testDir = join(tmpdir(), `orch-test-${randomUUID()}`);

    it('handles array input correctly', async () => {
      await mkdir(testDir, { recursive: true });
      const filePath = join(testDir, 'tasks.json');
      const taskList = [{ id: 'T1', title: 'T1' }];
      await writeFile(filePath, JSON.stringify(taskList));

      mock.method(orchestrator.taskManager, 'addTasks', async (tasks) => tasks);
      
      const loaded = await orchestrator.loadTasksFromFile(filePath);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, 'T1');
      
      await rm(testDir, { recursive: true, force: true });
    });

    it('handles {tasks:[]} wrapper correctly', async () => {
      await mkdir(testDir, { recursive: true });
      const filePath = join(testDir, 'tasks.json');
      const data = { tasks: [{ id: 'T2', title: 'T2' }] };
      await writeFile(filePath, JSON.stringify(data));

      mock.method(orchestrator.taskManager, 'addTasks', async (tasks) => tasks);
      
      const loaded = await orchestrator.loadTasksFromFile(filePath);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, 'T2');
      
      await rm(testDir, { recursive: true, force: true });
    });
  });

  describe('_extractJsonArray()', () => {
    it('finds JSON array in text with surrounding prose', () => {
      const text = 'Here is the plan: [{"id":"T1"}] Hope this helps!';
      const array = orchestrator._extractJsonArray(text);
      assert.deepEqual(array, [{ id: 'T1' }]);
    });

    it('handles direct JSON array', () => {
      const text = '[{"id":"T2"}]';
      const array = orchestrator._extractJsonArray(text);
      assert.deepEqual(array, [{ id: 'T2' }]);
    });

    it('throws error when no array found', () => {
      assert.throws(() => orchestrator._extractJsonArray('no array here'), /No JSON array found/);
    });
  });
});
