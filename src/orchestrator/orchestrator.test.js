import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from './index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';

describe('Orchestrator', () => {
  const orchestrator = new Orchestrator('/tmp/test-project');

  afterEach(() => {
    mock.restoreAll();
  });

  describe('initialize()', () => {
    it('creates all necessary directories including resultsDir', async () => {
      const rootDir = join(tmpdir(), `orch-init-test-${randomUUID()}`);
      const orchestrator = new Orchestrator(rootDir);
      
      // Mock adapters to avoid CLI checks
      mock.method(orchestrator.adapters, 'set');
      // We also need to mock isAvailable on candidates inside initialize
      // But candidates are created locally. 
      // Instead, let's mock the methods that might fail if dependencies aren't met.
      mock.method(orchestrator.taskManager, 'initialize', async () => {});
      mock.method(orchestrator.comms, 'initialize', async () => {});

      // Use a simpler approach: check if mkdir was called or just check disk after
      await orchestrator.initialize().catch(() => {}); // may throw if no agents, that's fine

      assert.ok(existsSync(orchestrator.agentTeamDir));
      assert.ok(existsSync(orchestrator.worktreesDir));
      assert.ok(existsSync(orchestrator.merger.resultsDir));

      await rm(rootDir, { recursive: true, force: true });
    });
  });

  describe('monitorUntilComplete()', () => {
    it('calls resetStaleClaims() on each iteration', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      orchestrator._running = true;
      
      const resetMock = mock.method(orchestrator.taskManager, 'resetStaleClaims', async () => []);
      const completeMock = mock.method(orchestrator.taskManager, 'isAllComplete', async () => {
        orchestrator._running = false; // Stop the loop after one iteration
        return true;
      });

      await orchestrator.monitorUntilComplete();
      
      assert.equal(resetMock.mock.callCount(), 1);
      assert.equal(completeMock.mock.callCount(), 1);
    });
  });

  describe('executeTasks()', () => {
    it('dispatches each task exactly once', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      
      const tasks = [
        { id: 'T1', status: 'pending', depends_on: [] },
        { id: 'T2', status: 'pending', depends_on: ['T1'] }
      ];

      // Stub taskManager methods
      mock.method(orchestrator.taskManager, 'getTasks', async () => tasks);
      mock.method(orchestrator.taskManager, 'isAllComplete', async () => {
        return tasks.every(t => t.status === 'done' || t.status === 'failed');
      });

      mock.method(orchestrator.taskManager, 'getSummary', async () => ({
        done: tasks.filter(t => t.status === 'done').length,
        pending: tasks.filter(t => t.status === 'pending').length,
        failed: tasks.filter(t => t.status === 'failed').length
      }));

      mock.method(orchestrator, '_handleFailedDependencies', async () => {});
      mock.method(orchestrator, 'assignTasks', async (ts) => {
        ts.forEach(t => {
          const task = tasks.find(rt => rt.id === t.id);
          if (task) task.status = 'in_progress';
        });
      });

      const dispatchedCount = new Map();
      mock.method(orchestrator, '_runTask', async (task) => {
        dispatchedCount.set(task.id, (dispatchedCount.get(task.id) || 0) + 1);
        // Find the task in our local array and mark it done
        const t = tasks.find(rt => rt.id === task.id);
        if (t) t.status = 'done';
      });

      // Override poll interval for fast test
      orchestrator.pollIntervalMs = 1;

      await orchestrator.executeTasks();

      assert.equal(dispatchedCount.get('T1'), 1);
      assert.equal(dispatchedCount.get('T2'), 1);
    });
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

    it('throws error when file is missing', async () => {
      const filePath = join(testDir, 'missing.json');
      await assert.rejects(
        () => orchestrator.loadTasksFromFile(filePath),
        /Tasks file not found/
      );
    });

    it('throws error on invalid JSON', async () => {
      await mkdir(testDir, { recursive: true });
      const filePath = join(testDir, 'invalid.json');
      await writeFile(filePath, 'not json');

      await assert.rejects(
        () => orchestrator.loadTasksFromFile(filePath),
        /Invalid JSON in tasks file/
      );
      
      await rm(testDir, { recursive: true, force: true });
    });

    it('throws error when no tasks found', async () => {
      await mkdir(testDir, { recursive: true });
      const filePath = join(testDir, 'empty.json');
      await writeFile(filePath, JSON.stringify([]));

      await assert.rejects(
        () => orchestrator.loadTasksFromFile(filePath),
        /Tasks file contains no tasks/
      );
      
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
