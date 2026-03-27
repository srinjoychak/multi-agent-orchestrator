import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRouter } from './index.js';

describe('AgentRouter', () => {
  const adapters = new Map([
    ['agent1', { capabilities: ['code', 'test'] }],
    ['agent2', { capabilities: ['research'] }],
    ['agent3', { capabilities: ['code'] }]
  ]);

  const config = {
    'agent1': { quota: 50, concurrency: 2 },
    'agent2': { quota: 50, concurrency: 1 },
    'agent3': { quota: 100, concurrency: 5 }
  };

  test('prioritizes task.forced_agent', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'research', forced_agent: 'agent1' };
    // agent1 doesn't have 'research' capability, but it's forced
    const selected = router.selectAgent(task);
    assert.equal(selected, 'agent1');
  });

  test('filters by capability', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'research' };
    const selected = router.selectAgent(task);
    assert.equal(selected, 'agent2');
  });

  test('filters by concurrency limits', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'code' };
    
    // agent1 has 'code' but is at concurrency limit (2)
    // agent3 has 'code' and is not at limit
    const runningCounts = { 'agent1': 2, 'agent3': 0 };
    const selected = router.selectAgent(task, runningCounts);
    assert.equal(selected, 'agent3');
  });

  test('respects previous_agents constraint initially', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'code', previous_agents: ['agent1'] };
    // agent1 and agent3 both have 'code', but agent1 was already tried
    const selected = router.selectAgent(task);
    assert.equal(selected, 'agent3');
  });

  test('fallback relaxes previous_agents constraint', () => {
    const router = new AgentRouter(adapters, config);
    const task = { type: 'code', previous_agents: ['agent1', 'agent3'] };
    // All capable agents tried, should fallback to one of them
    const selected = router.selectAgent(task);
    assert.ok(['agent1', 'agent3'].includes(selected));
  });

  test('assign() passes runningCounts and updates them', () => {
    const router = new AgentRouter(adapters, {
      'agent1': { quota: 100, concurrency: 2 },
      'agent3': { quota: 1, concurrency: 5 }
    });
    const tasks = [
      { id: 'T1', type: 'code' },
      { id: 'T2', type: 'code' },
      { id: 'T3', type: 'code' }
    ];
    
    // agent1 has quota 100, agent3 has quota 1.
    // agent1 will be preferred until its ratio exceeds agent3's.
    // T1 -> agent1 (ratio 0/100 = 0)
    // T2 -> agent1 (ratio 1/100 = 0.01, still < 0/1 = 0? No, 0/1 is 0)
    // Wait, 0/1 is 0. 0/100 is 0. 
    // If ratios are equal, it picks first in list: agent1.
    
    // T1: agent1(0/100=0), agent3(0/1=0) -> agent1
    // T2: agent1(1/100=0.01), agent3(0/1=0) -> agent3
    
    // This is still confusing because of how quota works.
    // Let's use a VERY large quota for agent1 and 0 for agent3? No, quota 0 means ratio is Infinity?
    // _quotaRatio: assigned / (quota ?? 1).
    
    // Let's just test concurrency by setting it to 1.
    const router2 = new AgentRouter(adapters, {
      'agent1': { quota: 100, concurrency: 1 },
      'agent3': { quota: 100, concurrency: 5 }
    });
    
    const runningCounts = { 'agent1': 0, 'agent3': 0 };
    const assignments = router2.assign(tasks, runningCounts);
    
    assert.equal(assignments.length, 3);
    assert.equal(assignments[0].agentName, 'agent1'); // T1 picks agent1
    assert.equal(assignments[1].agentName, 'agent3'); // T2 cannot pick agent1 (concurrency 1), picks agent3
    assert.equal(assignments[2].agentName, 'agent3'); // T3 cannot pick agent1, picks agent3
    
    assert.equal(runningCounts['agent1'], 1);
    assert.equal(runningCounts['agent3'], 2);
  });
});
