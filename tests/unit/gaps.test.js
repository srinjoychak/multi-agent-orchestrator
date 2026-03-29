import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Orchestrator } from '../../src/orchestrator/core.js';

async function makeTestEnv() {
  const dir = join(tmpdir(), `gaps-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const orchestrator = new Orchestrator(dir, { stateDir: dir, quiet: true });
  await orchestrator.initialize({ quiet: true });
  
  // Mock WorktreeManager.prune
  orchestrator.worktreeManager.prune = mock.fn(async () => {});
  
  // Mock WorktreeManager.create
  orchestrator.worktreeManager.create = mock.fn(async (id, agent) => ({ 
    path: join(dir, '.worktrees', `${agent}-${id}`),
    branch: `agent/${agent}/${id}`
  }));

  // Mock WorktreeManager.branchName
  orchestrator.worktreeManager.branchName = mock.fn((id, agent) => `agent/${agent}/${id}`);

  // Mock DockerRunner.kill
  orchestrator.docker.kill = mock.fn(async () => true);

  return { 
    dir, 
    orchestrator, 
    cleanup: async () => { 
      await orchestrator.taskManager.close();
      await rm(dir, { recursive: true, force: true }); 
    } 
  };
}

describe('Gap 4: discardTask', () => {
  it('discardTask prunes worktree and marks task as permanently failed', async () => {
    const { orchestrator, cleanup } = await makeTestEnv();
    try {
      await orchestrator.taskManager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 1 });
      await orchestrator.taskManager.claimTask('T1', 'gemini');
      await orchestrator.taskManager.updateStatus('T1', 'in_progress', { assigned_to: 'gemini' });
      
      const result = await orchestrator.discardTask('T1');
      assert.strictEqual(result.discarded, true);
      
      const task = await orchestrator.taskManager.getTask('T1');
      assert.strictEqual(task.status, 'failed');
      assert.strictEqual(task.retries, task.max_retries);
      
      // Verify prune was called
      assert.strictEqual(orchestrator.worktreeManager.prune.mock.calls.length, 1);
      assert.deepStrictEqual(orchestrator.worktreeManager.prune.mock.calls[0].arguments, ['T1', 'gemini']);
    } finally { await cleanup(); }
  });
});

describe('Gap 6: killTask pruning', () => {
  it('killTask prunes worktree if kill succeeds', async () => {
    const { orchestrator, cleanup } = await makeTestEnv();
    try {
      await orchestrator.taskManager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 0 });
      await orchestrator.taskManager.claimTask('T1', 'gemini');
      await orchestrator.taskManager.updateStatus('T1', 'in_progress', { 
        assigned_to: 'gemini',
        container_id: 'worker-gemini-T1' 
      });
      
      const result = await orchestrator.killTask('T1');
      assert.strictEqual(result.killed, true);
      
      const task = await orchestrator.taskManager.getTask('T1');
      assert.strictEqual(task.status, 'failed');
      
      // Verify prune was called
      assert.strictEqual(orchestrator.worktreeManager.prune.mock.calls.length, 1);
      assert.deepStrictEqual(orchestrator.worktreeManager.prune.mock.calls[0].arguments, ['T1', 'gemini']);
    } finally { await cleanup(); }
  });
});

describe('Gap 8: retryDue integration', () => {
  it('executeTasks calls taskManager.retryDue', async () => {
    const { orchestrator, cleanup } = await makeTestEnv();
    try {
      // Mock retryDue
      orchestrator.taskManager.retryDue = mock.fn(async () => 0);
      
      // We want to trigger at least one iteration of the loop in executeTasks
      // but exit quickly. We can do this by having no tasks.
      await orchestrator.executeTasks({ maxIterations: 1 });
      
      assert.strictEqual(orchestrator.taskManager.retryDue.mock.calls.length >= 1, true);
    } finally { await cleanup(); }
  });
});

describe('Gap 5: Failed task worktree sweep', () => {
  it('executeTasks prunes worktrees of permanently failed tasks', async () => {
    const { orchestrator, cleanup } = await makeTestEnv();
    try {
      await orchestrator.taskManager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 0 });
      await orchestrator.taskManager.claimTask('T1', 'gemini');
      await orchestrator.taskManager.updateStatus('T1', 'in_progress', { assigned_to: 'gemini' });
      await orchestrator.taskManager.updateStatus('T1', 'failed'); // max_retries=0, stays failed
      
      await orchestrator.executeTasks({ maxIterations: 1 });
      
      // Verify prune was called by the end-of-job sweep
      assert.strictEqual(orchestrator.worktreeManager.prune.mock.calls.length, 1);
      assert.deepStrictEqual(orchestrator.worktreeManager.prune.mock.calls[0].arguments, ['T1', 'gemini']);
    } finally { await cleanup(); }
  });
});

describe('Gap 7: agents.json hot-reload', () => {
  it('orchestrate re-loads agents.json', async () => {
    const { orchestrator, cleanup } = await makeTestEnv();
    try {
      // Mock _loadAgentsJson to return different values
      let callCount = 0;
      orchestrator._loadAgentsJson = mock.fn(async () => {
        callCount++;
        return { gemini: { quota: callCount * 10 } };
      });
      
      // Mock decomposeTasks to return empty to avoid full execution
      orchestrator.decomposeTasks = mock.fn(async () => []);
      
      await orchestrator.orchestrate('test prompt 1');
      assert.strictEqual(orchestrator.agents.get('gemini').quota, 10);
      
      await orchestrator.orchestrate('test prompt 2');
      assert.strictEqual(orchestrator.agents.get('gemini').quota, 20);
    } finally { await cleanup(); }
  });
});
