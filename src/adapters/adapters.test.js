import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeAdapter } from './claude-code.js';
import { GeminiAdapter } from './gemini.js';
import { AgentAdapter } from './base.js';

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  describe('buildArgs', () => {
    it('returns expected arguments', () => {
      const task = { title: 'Test Task', description: 'Test Description' };
      const context = { workDir: '/tmp/work', branch: 'test-branch' };
      const args = adapter.buildArgs(task, context);
      assert.deepEqual(args, [
        '-p',
        adapter._buildPrompt(task, context),
        '--output-format',
        'json',
        '--no-session-persistence',
        '--dangerously-skip-permissions',
      ]);
    });
  });

  describe('_buildPrompt', () => {
    it('includes required fields', () => {
      const task = { title: 'Test Task', description: 'Test Description' };
      const context = { workDir: '/tmp/work', branch: 'test-branch' };
      const prompt = adapter._buildPrompt(task, context);
      assert.ok(prompt.includes('Test Task'));
      assert.ok(prompt.includes('Test Description'));
      assert.ok(prompt.includes('/tmp/work'));
      assert.ok(prompt.includes('test-branch'));
    });
  });

  describe('parseOutput', () => {
    const duration = 123;

    it('handles valid JSON with result field', () => {
      const stdout = JSON.stringify({ result: 'Success' });
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Success');
      assert.equal(res.duration_ms, duration);
    });

    it('handles valid JSON with text field', () => {
      const stdout = JSON.stringify({ text: 'Some text' });
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Some text');
    });

    it('handles valid JSON with content array', () => {
      const stdout = JSON.stringify({
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
          { type: 'other', text: 'ignored' }
        ]
      });
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Part 1Part 2');
    });

    it('handles invalid JSON with raw text slice', () => {
      const stdout = 'Not JSON at all';
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Not JSON at all');
    });

    it('handles is_error flag', () => {
      const stdout = JSON.stringify({ is_error: true, result: 'Failed' });
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'failed');
      assert.equal(res.summary, 'Failed');
    });
  });

  describe('_extractFilesChanged', () => {
    it('extracts from files_changed array', () => {
      const parsed = { files_changed: ['a.js', 'b.js'] };
      assert.deepEqual(adapter._extractFilesChanged(parsed), ['a.js', 'b.js']);
    });

    it('extracts from changes array', () => {
      const parsed = { changes: [{ file: 'c.js' }, { file: 'd.js' }] };
      assert.deepEqual(adapter._extractFilesChanged(parsed), ['c.js', 'd.js']);
    });

    it('returns empty array if neither exists', () => {
      assert.deepEqual(adapter._extractFilesChanged({}), []);
    });
  });
});

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  describe('buildArgs', () => {
    it('returns expected arguments', () => {
      const task = { title: 'T', description: 'D' };
      const context = { workDir: 'W', branch: 'B' };
      const args = adapter.buildArgs(task, context);
      assert.deepEqual(args, [
        '-p',
        adapter._buildPrompt(task, context),
        '--output-format',
        'json',
        '--approval-mode=yolo',
      ]);
    });
  });

  describe('parseOutput', () => {
    const duration = 456;

    it('handles valid JSON with response field', () => {
      const stdout = JSON.stringify({ response: 'Hello from Gemini' });
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Hello from Gemini');
      assert.equal(res.duration_ms, duration);
    });

    it('handles valid JSON with candidates array', () => {
      const stdout = JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello' }, { text: ' world' }] } }]
      });
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Hello world');
    });

    it('handles newline-delimited JSON', () => {
      const stdout = '{"type":"log"}\n{"response":"Final answer"}';
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Final answer');
    });

    it('handles plain text fallback', () => {
      const stdout = 'Just some text';
      const res = adapter.parseOutput(stdout, '', duration);
      assert.equal(res.status, 'done');
      assert.equal(res.summary, 'Just some text');
    });
  });

  describe('_extractResultText', () => {
    it('handles response field', () => {
      assert.equal(adapter._extractResultText({ response: 'hi' }), 'hi');
    });

    it('handles candidates array', () => {
      const parsed = { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] };
      assert.equal(adapter._extractResultText(parsed), 'ab');
    });

    it('returns null for unknown shape', () => {
      assert.equal(adapter._extractResultText({ foo: 'bar' }), null);
    });
  });
});

describe('AgentAdapter base tests', () => {
  // Use a dummy subclass for testing base functionality
  class DummyAdapter extends AgentAdapter {
    constructor() { super('dummy', 'dummy-cli'); }
    buildArgs() { return ['arg1']; }
    parseOutput(stdout, stderr, duration) {
      return { status: 'done', summary: stdout, filesChanged: [], output: stdout, duration_ms: duration };
    }
  }

  afterEach(() => {
    mock.restoreAll();
  });

  it('getEnvOverrides returns {} by default', () => {
    const adapter = new DummyAdapter();
    assert.deepEqual(adapter.getEnvOverrides({}), {});
  });

  it('isAvailable() returns true when command exits 0', async () => {
    const adapter = new DummyAdapter();
    mock.method(adapter, '_execFile', async () => ({ stdout: 'v1.0.0', stderr: '' }));

    const available = await adapter.isAvailable();
    assert.strictEqual(available, true);
  });

  it('isAvailable() returns false when command throws', async () => {
    const adapter = new DummyAdapter();
    mock.method(adapter, '_execFile', async () => { throw new Error('not found'); });

    const available = await adapter.isAvailable();
    assert.strictEqual(available, false);
  });

  it('execute() calls buildArgs, _execFile, and parseOutput', async () => {
    const adapter = new DummyAdapter();
    const task = { id: 'T1' };
    const context = { workDir: '/tmp', branch: 'main' };

    mock.method(adapter, '_execFile', async (cmd, args, opts) => {
      assert.strictEqual(cmd, 'dummy-cli');
      assert.deepEqual(args, ['arg1']);
      assert.strictEqual(opts.cwd, '/tmp');
      return { stdout: 'success', stderr: '' };
    });

    const result = await adapter.execute(task, context);
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(result.summary, 'success');
    assert.ok(result.duration_ms >= 0);
  });

  it('execute() returns failed result when timed out', async () => {
    const adapter = new DummyAdapter();
    const task = { id: 'T1' };
    const context = { workDir: '/tmp', branch: 'main' };

    mock.method(adapter, '_execFile', async () => {
      const err = new Error('timed out');
      err.killed = true;
      err.stderr = 'stderr output';
      throw err;
    });

    const result = await adapter.execute(task, context);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.summary, /timed out/);
    assert.strictEqual(result.output, 'stderr output');
  });

  it('execute() returns failed result on generic error', async () => {
    const adapter = new DummyAdapter();
    const task = { id: 'T1' };
    const context = { workDir: '/tmp', branch: 'main' };

    mock.method(adapter, '_execFile', async () => { throw new Error('random failure'); });

    const result = await adapter.execute(task, context);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.summary, /failed:/);
  });
});
