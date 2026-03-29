import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRouter } from './index.js';

describe('AgentRouter', () => {
  const adapters = new Map([
    ['agent1', { capabilities: ['code', 'test'] }],
    ['agent2', { capabilities: ['research'] }],
    ['agent3', { capabilities: ['code'] }],
  ]);

  const config = {
    agent1: { quota: 50, concurrency: 2 },
    agent2: { quota: 50, concurrency: 1 },
    agent3: { quota: 100, concurrency: 5 },
  };

  test('prioritizes task.forced_agent and writes a routing reason', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'research', forced_agent: 'agent1' };

    const selected = router.selectAgent(task);

    assert.equal(selected, 'agent1');
    assert.equal(task.routing_reason, 'forced_agent:agent1');
  });

  test('filters by capability', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'research' };

    const selected = router.selectAgent(task);

    assert.equal(selected, 'agent2');
    assert.match(task.routing_reason, /type:research/);
  });

  test('respects provider preference order when multiple providers are eligible', () => {
    const router = new AgentRouter(adapters, {
      agent1: { quota: 50, concurrency: 2 },
      agent2: { quota: 50, concurrency: 1 },
      agent3: { quota: 100, concurrency: 5 },
    });
    const task = {
      type: 'code',
      preferred_providers: ['agent3', 'agent1'],
    };

    const selected = router.selectAgent(task);

    assert.equal(selected, 'agent3');
    assert.match(task.routing_reason, /preferred\[0\]/);
  });

  test('filters by concurrency limits', () => {
    const router = new AgentRouter(adapters, config);
    const task = {
      type: 'code',
      preferred_providers: ['agent1', 'agent3'],
    };

    const runningCounts = { agent1: 2, agent3: 0 };
    const selected = router.selectAgent(task, runningCounts);

    assert.equal(selected, 'agent3');
    assert.match(task.routing_reason, /fresh:/);
  });

  test('respects previous_agents constraint initially', () => {
    const router = new AgentRouter(adapters, config);
    const task = {
      type: 'code',
      previous_agents: ['agent1'],
      preferred_providers: ['agent1', 'agent3'],
    };

    const selected = router.selectAgent(task);

    assert.equal(selected, 'agent3');
    assert.match(task.routing_reason, /preferred\[1\]/);
  });

  test('fallback relaxes previous_agents constraint when all capable agents were tried', () => {
    const router = new AgentRouter(adapters, config);
    const task = {
      type: 'code',
      previous_agents: ['agent1', 'agent3'],
      preferred_providers: ['agent1', 'agent3'],
    };

    const selected = router.selectAgent(task);

    assert.ok(['agent1', 'agent3'].includes(selected));
    assert.match(task.routing_reason, /fallback:/);
  });

  test('assign() updates runningCounts and preserves routing reasons on tasks', () => {
    const router = new AgentRouter(adapters, {
      agent1: { quota: 100, concurrency: 1 },
      agent2: { quota: 50, concurrency: 1 },
      agent3: { quota: 100, concurrency: 5 },
    });
    const tasks = [
      { id: 'T1', type: 'code', preferred_providers: ['agent1', 'agent3'] },
      { id: 'T2', type: 'code', preferred_providers: ['agent1', 'agent3'] },
      { id: 'T3', type: 'code', preferred_providers: ['agent1', 'agent3'] },
    ];

    const runningCounts = { agent1: 0, agent3: 0 };
    const assignments = router.assign(tasks, runningCounts);

    assert.equal(assignments.length, 3);
    assert.equal(assignments[0].agentName, 'agent1');
    assert.equal(assignments[1].agentName, 'agent3');
    assert.equal(assignments[2].agentName, 'agent3');
    assert.equal(runningCounts.agent1, 1);
    assert.equal(runningCounts.agent3, 2);
    assert.ok(tasks.every(t => typeof t.routing_reason === 'string' && t.routing_reason.length > 0));
  });
});
