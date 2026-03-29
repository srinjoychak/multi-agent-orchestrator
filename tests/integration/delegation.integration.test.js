/**
 * Delegation Integration Tests
 * 17 tests covering TaskManager depth, Orchestrator.delegate(), 
 * Orphan Recovery, and MCP Tool Schemas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskManager } from '../../src/taskmanager/index.js';
import { Orchestrator } from '../../src/orchestrator/core.js';
import { TOOLS } from '../../src/mcp-server/tools.js';
import { makeMockDockerRunner, makeMockWorktreeManager } from './delegation-mocks.js';

async function createTempDir() {
  return await mkdtemp(join(tmpdir(), 'delegation-test-'));
}

test('TaskManager Delegation', async (t) => {
  const stateDir = await createTempDir();
  const tm = new TaskManager(stateDir);
  await tm.initialize();

  await t.test('depth limit 1: child task creation', async () => {
    const parent = await tm.addTask({ id: 'P1', title: 'Parent' });
    const child = await tm.createDelegatedTask('P1', { id: 'C1', title: 'Child' });
    assert.strictEqual(child.parent_task_id, 'P1');
    assert.strictEqual(child.delegate_depth, 1);
    assert.strictEqual(child.is_delegated, true);
  });

  await t.test('depth limit 2: grandchild task creation', async () => {
    const grandchild = await tm.createDelegatedTask('C1', { id: 'G1', title: 'Grandchild' });
    assert.strictEqual(grandchild.parent_task_id, 'C1');
    assert.strictEqual(grandchild.delegate_depth, 2);
  });

  await t.test('depth limit 3: great-grandchild task creation', async () => {
    const greatGrandchild = await tm.createDelegatedTask('G1', { id: 'GG1', title: 'Great-Grandchild' });
    assert.strictEqual(greatGrandchild.parent_task_id, 'G1');
    assert.strictEqual(greatGrandchild.delegate_depth, 3);
  });

  await t.test('depth limit 4: should fail (MAX_DELEGATE_DEPTH=3)', async () => {
    await assert.rejects(
      () => tm.createDelegatedTask('GG1', { id: 'GGG1', title: 'Too Deep' }),
      /Maximum delegation depth \(3\) exceeded/
    );
  });

  await t.test('tree ordering: recursive CTE returns correct sequence', async () => {
    const tree = await tm.getTaskTree('P1');
    // Expected order: delegate_depth, created_at
    // P1 (0), C1 (1), G1 (2), GG1 (3)
    assert.strictEqual(tree.length, 4);
    assert.strictEqual(tree[0].id, 'P1');
    assert.strictEqual(tree[1].id, 'C1');
    assert.strictEqual(tree[2].id, 'G1');
    assert.strictEqual(tree[3].id, 'GG1');
  });

  await rm(stateDir, { recursive: true, force: true });
});

test('Orchestrator.delegate() with Mock Injection', async (t) => {
  const stateDir = await createTempDir();
  const orch = new Orchestrator('/tmp/mock-project', { stateDir });
  
  // Inject mocks
  orch.docker = makeMockDockerRunner();
  orch.worktreeManager = makeMockWorktreeManager();
  
  await orch.initialize({ quiet: true });

  await t.test('successful delegation returns result envelope', async () => {
    const result = await orch.delegate('gemini', 'Research things', 'research');
    assert.strictEqual(typeof result, 'object');
    assert.ok(typeof result.summary === 'string');
    assert.strictEqual(result.provider, 'gemini');
    assert.ok(Array.isArray(result.files_changed));
  });

  await t.test('result envelope contains metadata and duration', async () => {
    const result = await orch.delegate('claude-code', 'Fix bug', 'code');
    assert.strictEqual(result.provider, 'claude-code');
    assert.strictEqual(typeof result.duration_ms, 'number');
    assert.ok(result.duration_ms >= 0);
  });

  await t.test('failure case: unknown subagent', async () => {
    await assert.rejects(
      () => orch.delegate('unknown-agent', 'Do something'),
      /Unknown subagent: unknown-agent/
    );
  });

  await t.test('failure case: depth limit (via Orchestrator)', async () => {
    // Manually create a task at depth 3
    const p = await orch.taskManager.addTask({ id: 'D3', title: 'Depth 3', delegate_depth: 3 });
    await assert.rejects(
      () => orch.delegate('gemini', 'Deep task', 'code', 'D3'),
      /delegate_depth limit exceeded/
    );
  });

  await t.test('merge-back behavior: research tasks skip merge', async () => {
    const result = await orch.delegate('gemini', 'Research', 'research');
    // Research types: research, analysis, docs. They skip merge.
    assert.strictEqual(result.merged, undefined);
  });

  await rm(stateDir, { recursive: true, force: true });
});

test('Orphan Recovery', async (t) => {
  const stateDir = await createTempDir();
  const tm = new TaskManager(stateDir);
  await tm.initialize();

  await t.test('recovery of delegated tasks with routing_reason=orchestrator_restart', async () => {
    // Add a delegated task in_progress
    await tm.db.prepare(`
      INSERT INTO tasks (id, title, status, is_delegated, delegate_depth)
      VALUES ('O1', 'Orphan', 'in_progress', 1, 1)
    `).run();

    // Re-initialize to trigger recovery
    const tm2 = new TaskManager(stateDir);
    await tm2.initialize();

    const task = await tm2.getTask('O1');
    assert.strictEqual(task.status, 'failed');
    assert.strictEqual(task.routing_reason, 'orchestrator_restart');
  });

  await t.test('orphan recovery scoped only to is_delegated=1', async () => {
    // Add a normal task in_progress
    await tm.db.prepare(`
      INSERT INTO tasks (id, title, status, is_delegated, delegate_depth)
      VALUES ('N1', 'Normal', 'in_progress', 0, 0)
    `).run();

    // Re-initialize
    const tm3 = new TaskManager(stateDir);
    await tm3.initialize();

    const task = await tm3.getTask('N1');
    // Normal tasks remain in_progress (they are handled by resetStaleClaims or keep running)
    assert.strictEqual(task.status, 'in_progress');
  });

  await rm(stateDir, { recursive: true, force: true });
});

test('MCP Tool Schema Validation', async (t) => {
  const getTool = (name) => TOOLS.find(tool => tool.name === name);

  await t.test('delegate tool schema has required fields', async () => {
    const tool = getTool('delegate');
    assert.ok(tool, 'delegate tool exists');
    assert.deepStrictEqual(tool.inputSchema.required, ['subagent_name', 'prompt']);
    assert.strictEqual(tool.inputSchema.properties.subagent_name.type, 'string');
  });

  await t.test('list_subagents tool schema', async () => {
    const tool = getTool('list_subagents');
    assert.ok(tool, 'list_subagents tool exists');
    assert.strictEqual(tool.inputSchema.type, 'object');
  });

  await t.test('task_status tool schema', async () => {
    const tool = getTool('task_status');
    assert.ok(tool, 'task_status tool exists');
    assert.ok(tool.inputSchema.properties.id);
  });

  await t.test('delegate tool includes type enum', async () => {
    const tool = getTool('delegate');
    const typeEnum = tool.inputSchema.properties.type.enum;
    assert.ok(Array.isArray(typeEnum));
    assert.ok(typeEnum.includes('code'));
    assert.ok(typeEnum.includes('research'));
  });

  await t.test('list_subagents tool description', async () => {
    const tool = getTool('list_subagents');
    assert.ok(tool.description.includes('capabilities'));
  });
});
