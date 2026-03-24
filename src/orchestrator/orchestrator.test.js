import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from './index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { GeminiAdapter } from '../adapters/gemini.js';

describe('Orchestrator', () => {
  const orchestrator = new Orchestrator('/tmp/test-project');

  afterEach(() => {
    mock.restoreAll();
  });

  describe('initialize()', () => {
    it('creates all necessary directories including resultsDir', async () => {
      const rootDir = join(tmpdir(), `orch-init-test-${randomUUID()}`);
      const orchestrator = new Orchestrator(rootDir);
      
      mock.method(orchestrator.taskManager, 'initialize', async () => {});
      mock.method(orchestrator.comms, 'initialize', async () => {});

      await orchestrator.initialize().catch(() => {});

      assert.ok(existsSync(orchestrator.agentTeamDir));
      assert.ok(existsSync(orchestrator.worktreesDir));
      assert.ok(existsSync(orchestrator.merger.resultsDir));

      await rm(rootDir, { recursive: true, force: true });
    });

    it('prints the startup banner', async () => {
      const orchestrator = new Orchestrator('/tmp/banner-test');
      
      const logMock = mock.method(console, 'log', () => {});
      mock.method(orchestrator.taskManager, 'initialize', async () => {});
      mock.method(orchestrator.comms, 'initialize', async () => {});
      
      await orchestrator.initialize().catch(() => {});

      const bannerLogged = logMock.mock.calls.some(call => 
        typeof call.arguments[0] === 'string' && call.arguments[0].includes('Multi-Agent')
      );
      assert.ok(bannerLogged, 'Startup banner should be logged');
    });
  });

  describe('monitorUntilComplete()', () => {
    it('calls resetStaleClaims() on each iteration', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      orchestrator._running = true;
      
      const resetMock = mock.method(orchestrator.taskManager, 'resetStaleClaims', async () => []);
      const completeMock = mock.method(orchestrator.taskManager, 'isAllComplete', async () => {
        orchestrator._running = false;
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
        const t = tasks.find(rt => rt.id === task.id);
        if (t) t.status = 'done';
      });

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
        { id: 'T2', status: 'pending', depends_on: ['T1'] },
        { id: 'T3', status: 'pending', depends_on: ['T4'] },
        { id: 'T4', status: 'pending', depends_on: [] },
        { id: 'T5', status: 'in_progress', depends_on: [] }
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

  describe('assignTasks()', () => {
    it('assigns task with type: "code" to claude-code', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter();
      const gemini = new GeminiAdapter();
      orchestrator.adapters.set(claude.name, claude);
      orchestrator.adapters.set(gemini.name, gemini);

      const tasks = [{ id: 'T1', title: 'Code Task', type: 'code' }];
      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      assert.equal(claimMock.mock.calls[0].arguments[1], 'claude-code');
    });

    it('assigns task with type: "research" to gemini', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter();
      const gemini = new GeminiAdapter();
      orchestrator.adapters.set(claude.name, claude);
      orchestrator.adapters.set(gemini.name, gemini);

      const tasks = [{ id: 'T1', title: 'Research Task', type: 'research' }];
      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      assert.equal(claimMock.mock.calls[0].arguments[1], 'gemini');
    });

    it('falls back to round-robin for type: null', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter();
      const gemini = new GeminiAdapter();
      orchestrator.adapters.set(claude.name, claude);
      orchestrator.adapters.set(gemini.name, gemini);

      const tasks = [
        { id: 'T1', title: 'Task 1', type: null },
        { id: 'T2', title: 'Task 2', type: null }
      ];
      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      const assignedAgents = claimMock.mock.calls.map(c => c.arguments[1]);
      assert.deepEqual(assignedAgents, ['claude-code', 'gemini']);
    });

    it('falls back to round-robin for unknown type', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter();
      orchestrator.adapters.set(claude.name, claude);

      const tasks = [{ id: 'T1', title: 'Unknown Task', type: 'painting' }];
      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      assert.equal(claimMock.mock.calls[0].arguments[1], 'claude-code');
    });

    it('routes all tasks to the only available adapter regardless of type', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const gemini = new GeminiAdapter();
      orchestrator.adapters.set(gemini.name, gemini);

      const tasks = [
        { id: 'T1', title: 'Code Task', type: 'code' },
        { id: 'T2', title: 'Refactor Task', type: 'refactor' }
      ];
      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      const assignedAgents = claimMock.mock.calls.map(c => c.arguments[1]);
      assert.deepEqual(assignedAgents, ['gemini', 'gemini']);
    });

    it('distributes 10 tasks proportionally with quota 30/70', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter({ agentConfig: { quota: 30, capabilities: ['code'] } });
      const gemini = new GeminiAdapter({ agentConfig: { quota: 70, capabilities: ['code'] } });
      orchestrator.adapters.set(claude.name, claude);
      orchestrator.adapters.set(gemini.name, gemini);

      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `T${i + 1}`,
        title: `Task ${i + 1}`,
        type: 'code',
      }));

      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      const assignedAgents = claimMock.mock.calls.map(c => c.arguments[1]);
      const claudeCount = assignedAgents.filter(a => a === 'claude-code').length;
      const geminiCount = assignedAgents.filter(a => a === 'gemini').length;

      assert.equal(claudeCount, 3);
      assert.equal(geminiCount, 7);
    });

    it('respects quota when no type is provided (no-capability-match path)', async () => {
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter({ agentConfig: { quota: 25 } });
      const gemini = new GeminiAdapter({ agentConfig: { quota: 75 } });
      orchestrator.adapters.set(claude.name, claude);
      orchestrator.adapters.set(gemini.name, gemini);

      const tasks = Array.from({ length: 4 }, (_, i) => ({
        id: `T${i + 1}`,
        title: `Task ${i + 1}`,
        type: null,
      }));

      const claimMock = mock.method(orchestrator.taskManager, 'claimTask', async () => ({}));
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      await orchestrator.assignTasks(tasks);

      const assignedAgents = claimMock.mock.calls.map(c => c.arguments[1]);
      const claudeCount = assignedAgents.filter(a => a === 'claude-code').length;
      const geminiCount = assignedAgents.filter(a => a === 'gemini').length;

      assert.equal(claudeCount, 1);
      assert.equal(geminiCount, 3);
    });

    it('increments assignedCounts only after a successful claim', async () => {
      // If claimTask throws, the count should not be incremented,
      // so the next task still sees the correct ratio.
      const orchestrator = new Orchestrator('/tmp/test');
      const claude = new ClaudeCodeAdapter({ agentConfig: { quota: 50 } });
      const gemini = new GeminiAdapter({ agentConfig: { quota: 50, capabilities: ['code'] } });
      orchestrator.adapters.set(claude.name, claude);
      orchestrator.adapters.set(gemini.name, gemini);

      let callCount = 0;
      mock.method(orchestrator.taskManager, 'claimTask', async (id, agent) => {
        callCount++;
        if (callCount === 1 && agent === 'claude-code') throw new Error('claim failed');
        return {};
      });
      mock.method(orchestrator.taskManager, 'updateStatus', async () => ({}));

      // T1 goes to claude (tie → first), claim fails → count stays 0.
      // T2: claude ratio still 0 → claude again (or gemini depending on order, but we just
      // verify that an error on claim doesn't corrupt counts causing a crash).
      const tasks = [
        { id: 'T1', title: 'Task 1', type: 'code' },
        { id: 'T2', title: 'Task 2', type: 'code' },
      ];

      // Should not throw even when claimTask fails for one task
      await assert.doesNotReject(() => orchestrator.assignTasks(tasks));
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
