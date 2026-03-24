import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { FileCommChannel } from './file-channel.js';

const TEST_AGENTS = ['alpha', 'beta', 'gamma'];

/**
 * Create an isolated temp environment with a FileCommChannel already initialized.
 */
async function makeTestEnv(agents = TEST_AGENTS) {
  const dir = join(tmpdir(), `fc-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const channel = new FileCommChannel(dir, agents);
  await channel.initialize();
  return {
    dir,
    channel,
    cleanup: async () => {
      await channel.destroy();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function makeMessage(overrides = {}) {
  return {
    from: 'alpha',
    to: 'beta',
    type: 'task_update',
    payload: { status: 'done' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------
describe('FileCommChannel.send()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('creates a JSON file in the correct inbox directory', async () => {
    await env.channel.send('beta', makeMessage());
    const inboxDir = join(env.dir, 'inbox', 'beta');
    const files = await readdir(inboxDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    assert.equal(jsonFiles.length, 1);
  });

  it('file content is valid JSON matching the message', async () => {
    // Send another to beta for fresh state
    const msg = makeMessage({ payload: { hello: 'world' } });
    await env.channel.send('beta', msg);

    const inboxDir = join(env.dir, 'inbox', 'beta');
    const files = (await readdir(inboxDir)).filter((f) => f.endsWith('.json')).sort();
    // Read last file
    const { readFile } = await import('node:fs/promises');
    const content = JSON.parse(await readFile(join(inboxDir, files[files.length - 1]), 'utf-8'));
    assert.equal(content.from, 'alpha');
    assert.equal(content.to, 'beta');
    assert.equal(content.type, 'task_update');
    assert.ok(content.id);
    assert.ok(content.timestamp);
  });
});

// ---------------------------------------------------------------------------
// receive()
// ---------------------------------------------------------------------------
describe('FileCommChannel.receive()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('returns empty array for empty inbox', async () => {
    const messages = await env.channel.receive('gamma');
    assert.deepEqual(messages, []);
  });

  it('returns messages in timestamp order', async () => {
    // Send two messages with explicit timestamps to force ordering
    const ts1 = new Date(Date.now() - 1000).toISOString();
    const ts2 = new Date(Date.now()).toISOString();
    await env.channel.send('alpha', { ...makeMessage({ to: 'alpha' }), timestamp: ts1, id: 'msg-1' });
    await env.channel.send('alpha', { ...makeMessage({ to: 'alpha' }), timestamp: ts2, id: 'msg-2' });

    const messages = await env.channel.receive('alpha');
    assert.equal(messages.length, 2);
    // The filenames are sorted by timestamp prefix, so first should be earlier
    assert.ok(messages[0].timestamp <= messages[1].timestamp);
  });

  it('deletes message files after reading (consume-once)', async () => {
    await env.channel.send('beta', makeMessage());
    await env.channel.receive('beta');

    const inboxDir = join(env.dir, 'inbox', 'beta');
    const remaining = (await readdir(inboxDir)).filter((f) => f.endsWith('.json'));
    assert.equal(remaining.length, 0);
  });

  it('returns empty array on second call after consumption', async () => {
    // inbox should already be empty from previous test
    const messages = await env.channel.receive('beta');
    assert.deepEqual(messages, []);
  });
});

// ---------------------------------------------------------------------------
// peek()
// ---------------------------------------------------------------------------
describe('FileCommChannel.peek()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('returns messages without deleting them', async () => {
    await env.channel.send('gamma', makeMessage({ to: 'gamma' }));

    const first = await env.channel.peek('gamma');
    assert.equal(first.length, 1);

    const second = await env.channel.peek('gamma');
    assert.equal(second.length, 1, 'file should still exist after peek');
  });

  it('returns empty array for empty inbox', async () => {
    const messages = await env.channel.peek('alpha');
    assert.deepEqual(messages, []);
  });

  it('returns correct message content', async () => {
    const [msg] = await env.channel.peek('gamma');
    assert.equal(msg.type, 'task_update');
    assert.ok(msg.id);
  });
});

// ---------------------------------------------------------------------------
// broadcast()
// ---------------------------------------------------------------------------
describe('FileCommChannel.broadcast()', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('delivers a message to all agent inboxes', async () => {
    await env.channel.broadcast(makeMessage({ from: 'orchestrator' }));

    for (const agent of TEST_AGENTS) {
      const messages = await env.channel.receive(agent);
      assert.equal(messages.length, 1, `Agent ${agent} should have received the broadcast`);
      assert.equal(messages[0].from, 'orchestrator');
      assert.equal(messages[0].to, agent);
    }
  });

  it('each agent gets a separate copy (not the same reference)', async () => {
    await env.channel.broadcast({ from: 'orchestrator', type: 'shutdown', payload: {} });

    const alphaMessages = await env.channel.receive('alpha');
    const betaMessages = await env.channel.receive('beta');
    // Same content but addressed individually
    assert.equal(alphaMessages[0].to, 'alpha');
    assert.equal(betaMessages[0].to, 'beta');
  });
});

// ---------------------------------------------------------------------------
// subscribe()
// ---------------------------------------------------------------------------
describe('FileCommChannel.subscribe()', () => {
  it('calls callback when messages arrive (polling at 200ms)', async () => {
    const env = await makeTestEnv();
    try {
      const received = [];

      env.channel.subscribe('beta', (msg) => {
        received.push(msg);
      }, 200);

      // Send a message after a small delay so the poller can pick it up
      await new Promise((r) => setTimeout(r, 50));
      await env.channel.send('beta', makeMessage({ payload: { value: 42 } }));

      // Wait enough time for the poll interval to fire and consume the message
      await new Promise((r) => setTimeout(r, 500));

      assert.equal(received.length, 1);
      assert.equal(received[0].payload.value, 42);
    } finally {
      await env.cleanup();
    }
  });

  it('does not call callback when inbox is empty', async () => {
    const env = await makeTestEnv();
    try {
      let callCount = 0;
      env.channel.subscribe('alpha', () => { callCount++; }, 200);

      await new Promise((r) => setTimeout(r, 500));
      assert.equal(callCount, 0);
    } finally {
      await env.cleanup();
    }
  });

  it('destroy() stops polling', async () => {
    const env = await makeTestEnv();
    const received = [];

    env.channel.subscribe('beta', (msg) => received.push(msg), 200);
    await env.channel.destroy();

    // Send a message AFTER destroy — should NOT be received
    await env.channel.send('beta', makeMessage({ payload: { secret: true } }));
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(received.length, 0);
    // Manual cleanup since destroy() was already called
    await rm(env.dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Empty inbox edge case
// ---------------------------------------------------------------------------
describe('Empty inbox returns empty array', () => {
  let env;
  before(async () => { env = await makeTestEnv(); });
  after(async () => { await env.cleanup(); });

  it('receive() returns [] for agent with no messages', async () => {
    assert.deepEqual(await env.channel.receive('alpha'), []);
  });

  it('peek() returns [] for agent with no messages', async () => {
    assert.deepEqual(await env.channel.peek('beta'), []);
  });

  it('receive() returns [] for agent whose inbox dir does not exist', async () => {
    // Use a channel with an agent not in agentNames (no dir created)
    const channel2 = new FileCommChannel(env.dir, ['alpha', 'beta', 'gamma']);
    assert.deepEqual(await channel2.receive('unknown-agent'), []);
  });
});
