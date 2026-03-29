import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from './registry.js';
import { GeminiAdapter } from './gemini.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

test('Provider Registry', async (t) => {
  await t.test('should have registered default providers', () => {
    const providers = registry.listProviders();
    assert.ok(providers.includes('gemini'));
    assert.ok(providers.includes('claude'));
    assert.ok(providers.includes('claude-code'));
    assert.ok(providers.includes('codex'));
  });

  await t.test('should return correct adapter by name', () => {
    assert.ok(registry.get('gemini') instanceof GeminiAdapter);
    assert.ok(registry.get('claude') instanceof ClaudeAdapter);
    assert.ok(registry.get('claude-code') instanceof ClaudeAdapter);
    assert.ok(registry.get('codex') instanceof CodexAdapter);
  });

  await t.test('should throw for unknown provider', () => {
    assert.throws(() => registry.get('unknown'), /Unknown provider: unknown/);
  });
});

test('Gemini Adapter', async (t) => {
  const adapter = new GeminiAdapter();

  await t.test('buildCliArgs should return expected arguments', () => {
    const args = adapter.buildCliArgs('test prompt');
    assert.deepEqual(args, ['-p', 'test prompt', '--approval-mode', 'yolo', '--output-format', 'json']);
  });

  await t.test('parseOutput should handle empty output', () => {
    const result = adapter.parseOutput('', '', 100);
    assert.equal(result.status, 'done');
    assert.equal(result.summary, '');
  });

  await t.test('parseOutput should parse valid JSON output', () => {
    const output = JSON.stringify({
      response: 'test response',
      stats: {
        models: {
          'gemini-2.0-flash': {
            tokens: { input: 10, candidates: 5, thoughts: 2, total: 17 }
          }
        }
      }
    });
    const result = adapter.parseOutput(output, '', 100);
    assert.equal(result.status, 'done');
    assert.equal(result.summary, 'test response');
    assert.deepEqual(result.token_usage, { input: 10, output: 5, thoughts: 2, total: 17 });
  });

  await t.test('parseOutput should handle noisy output with JSON inside', () => {
    const output = 'some noise\n{"response": "clean response"}\nmore noise';
    const result = adapter.parseOutput(output, '', 100);
    assert.equal(result.status, 'done');
    assert.equal(result.summary, 'clean response');
  });
});

test('Claude Adapter', async (t) => {
  const adapter = new ClaudeAdapter();

  await t.test('buildCliArgs should return expected arguments', () => {
    const args = adapter.buildCliArgs('test prompt');
    assert.ok(args.includes('-p'));
    assert.ok(args.includes('test prompt'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
  });

  await t.test('parseOutput should parse valid Claude JSON', () => {
    const output = JSON.stringify({
      text: 'claude response',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10
      }
    });
    const result = adapter.parseOutput(output, '', 100);
    assert.equal(result.status, 'done');
    assert.equal(result.summary, 'claude response');
    assert.deepEqual(result.token_usage, { input: 100, output: 50, cache_read: 10, cost_usd: undefined });
  });
});

test('Codex Adapter', async (t) => {
  const adapter = new CodexAdapter();

  await t.test('parseOutput should handle NDJSON output', () => {
    const output = '{"type": "message", "content": "part 1"}\n{"type": "message", "content": "part 2", "usage": {"input": 10, "output": 5}}';
    const result = adapter.parseOutput(output, '', 100);
    assert.equal(result.status, 'done');
    assert.equal(result.summary, 'part 2');
    assert.deepEqual(result.token_usage, { input: 10, output: 5, total: 0 });
  });
});
