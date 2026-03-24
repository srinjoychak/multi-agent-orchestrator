import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { skipIfNoCli, makeTmpDir } from './helpers.js';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { GeminiAdapter } from '../../src/adapters/gemini.js';

describe('Adapter Integration Tests', () => {

  test('ClaudeCodeAdapter: isAvailable()', async (t) => {
    const adapter = new ClaudeCodeAdapter();
    const available = await adapter.isAvailable();
    // This just verifies it returns boolean, but we can't assert true/false 
    // unless we know the environment.
    assert.strictEqual(typeof available, 'boolean');
  });

  test('ClaudeCodeAdapter: execute() simple prompt', async (t) => {
    await skipIfNoCli('claude', t);
    
    const env = await makeTmpDir();
    try {
      const adapter = new ClaudeCodeAdapter();
      const task = { id: 'T1', title: 'Hello', description: 'Just say hello and do nothing else.' };
      const context = { 
        workDir: env.path, 
        branch: 'test-claude-integration',
        projectRoot: process.cwd()
      };
      
      const result = await adapter.execute(task, context);
      
      assert.ok(result.status === 'done' || result.status === 'failed');
      assert.ok(typeof result.summary === 'string');
      assert.ok(Array.isArray(result.filesChanged));
      assert.ok(typeof result.duration_ms === 'number');
    } finally {
      await env.cleanup();
    }
  });

  test('GeminiAdapter: isAvailable()', async (t) => {
    const adapter = new GeminiAdapter();
    const available = await adapter.isAvailable();
    assert.strictEqual(typeof available, 'boolean');
  });

  test('GeminiAdapter: execute() simple prompt', async (t) => {
    await skipIfNoCli('gemini', t);
    
    const env = await makeTmpDir();
    try {
      const adapter = new GeminiAdapter();
      const task = { id: 'T2', title: 'Hello', description: 'Just say hello.' };
      const context = { 
        workDir: env.path, 
        branch: 'test-gemini-integration',
        projectRoot: process.cwd()
      };
      
      const result = await adapter.execute(task, context);
      
      assert.ok(result.status === 'done' || result.status === 'failed');
      assert.ok(typeof result.summary === 'string');
      assert.ok(Array.isArray(result.filesChanged));
      assert.ok(typeof result.duration_ms === 'number');
    } finally {
      await env.cleanup();
    }
  });

});
