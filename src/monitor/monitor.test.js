import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceMonitor } from './index.js';

function makeMockDocker(containers = []) {
  return {
    listWorkers: mock.fn(async () => containers),
    logs: mock.fn(async () => ({ stdout: 'some output', stderr: '' })),
    kill: mock.fn(async () => true),
  };
}

function makeMockTaskManager(tasks = {}) {
  return {
    getTask: mock.fn(async (id) => {
      if (tasks[id]) return tasks[id];
      throw new Error(`Task ${id} not found`);
    }),
    getSummary: mock.fn(async () => ({ pending: 0, in_progress: 0, done: 0, failed: 0, total: 0 })),
  };
}

describe('WorkforceMonitor', () => {
  it('check() with no containers returns empty results', async () => {
    const docker = makeMockDocker([]);
    const tm = makeMockTaskManager({});
    const monitor = new WorkforceMonitor(docker, tm);
    
    const result = await monitor.check();
    assert.deepStrictEqual(result, { healthy: [], stuck: [], killed: [] });
  });

  it('check() with one healthy container returns it in healthy array', async () => {
    const containers = [{ name: 'worker-gemini-T1', created: new Date().toISOString() }];
    const docker = makeMockDocker(containers);
    const tm = makeMockTaskManager({ 'T1': { max_retries: 1 } });
    const monitor = new WorkforceMonitor(docker, tm);
    
    const result = await monitor.check();
    assert.strictEqual(result.healthy.length, 1);
    assert.strictEqual(result.healthy[0].name, 'worker-gemini-T1');
    assert.strictEqual(result.stuck.length, 0);
  });

  it('check() with stuck container (running past timeout) kills it', async () => {
    // 2 * 5min = 10min. Let's make it 20min old.
    const created = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const containers = [{ name: 'worker-gemini-T1', created }];
    const docker = makeMockDocker(containers);
    const tm = makeMockTaskManager({ 'T1': { max_retries: 1 } });
    const monitor = new WorkforceMonitor(docker, tm);
    
    const result = await monitor.check();
    assert.strictEqual(result.stuck.length, 1);
    assert.strictEqual(result.killed.length, 1);
    assert.strictEqual(result.killed[0], 'worker-gemini-T1');
    assert.strictEqual(docker.kill.mock.callCount(), 1);
  });

  it('status() returns containers, summary and lastCheck', async () => {
    const docker = makeMockDocker([]);
    const tm = makeMockTaskManager({});
    const monitor = new WorkforceMonitor(docker, tm);
    
    await monitor.check();
    const status = await monitor.status();
    
    assert.ok(status.containers);
    assert.ok(status.summary);
    assert.ok(status.lastCheck);
    assert.match(status.lastCheck, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('start() creates an interval', () => {
    const monitor = new WorkforceMonitor({}, {});
    assert.strictEqual(monitor._interval, null);
    monitor.start();
    assert.ok(monitor._interval);
    monitor.stop();
  });

  it('stop() clears the interval', () => {
    const monitor = new WorkforceMonitor({}, {});
    monitor.start();
    assert.ok(monitor._interval);
    monitor.stop();
    assert.strictEqual(monitor._interval, null);
  });

  it('Container name parsing: worker-gemini-T1 extracts taskId T1', async () => {
    const containers = [{ name: 'worker-gemini-T1', created: new Date().toISOString() }];
    const docker = makeMockDocker(containers);
    const tm = makeMockTaskManager({ 'T1': { max_retries: 1 } });
    const monitor = new WorkforceMonitor(docker, tm);
    
    await monitor.check();
    
    // Verify getTask was called with 'T1'
    const call = tm.getTask.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'T1');
  });

  it('Container name parsing: worker-claude-code-T2 extracts code-T2 (known limitation)', async () => {
    const containers = [{ name: 'worker-claude-code-T2', created: new Date().toISOString() }];
    const docker = makeMockDocker(containers);
    // Note: We expect 'code-T2' because of the parts.slice(2).join('-') logic
    const tm = makeMockTaskManager({ 'code-T2': { max_retries: 1 } });
    const monitor = new WorkforceMonitor(docker, tm);
    
    await monitor.check();
    
    const call = tm.getTask.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'code-T2');
  });
});
