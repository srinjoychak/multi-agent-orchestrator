import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { skipIfNoCli, makeTmpDir } from './helpers.js';
import { GeminiAdapter } from '../../src/adapters/gemini.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('Gemini Smoke Test', () => {

  test('GeminiAdapter: execute() trivial file creation task', async (t) => {
    // Skip if gemini CLI is not available in PATH
    await skipIfNoCli('gemini', t);
    
    const env = await makeTmpDir();
    try {
      // Initialize git repo in tmp dir so git diff works
      await execFileAsync('git', ['init'], { cwd: env.path });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: env.path });
      await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: env.path });
      // Create initial commit
      const readmePath = join(env.path, 'README.md');
      await execFileAsync('powershell', ['-Command', 'echo "initial" > README.md'], { cwd: env.path });
      await execFileAsync('git', ['add', '.'], { cwd: env.path });
      await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: env.path });

      const adapter = new GeminiAdapter({ timeoutMs: 120000 });
      const task = { 
        id: 'SMOKE-T1', 
        title: 'Create a text file', 
        description: 'Create a file called gemini-smoke-output.txt containing the text "Gemini Smoke Test Success" and nothing else.',
        type: 'code'
      };
      const context = { 
        workDir: env.path, 
        branch: 'smoke-test-branch',
        projectRoot: process.cwd()
      };
      
      const startTime = Date.now();
      const result = await adapter.execute(task, context);
      const duration = Date.now() - startTime;
      
      console.log(`Gemini smoke test completed in ${duration}ms with status: ${result.status}`);
      
      assert.strictEqual(result.status, 'done', `Task should be done. Output: ${result.output}`);
      assert.ok(result.duration_ms < 120000, `Should complete in < 120s, took ${result.duration_ms}ms`);
      
      const smokeFilePath = join(env.path, 'gemini-smoke-output.txt');
      assert.ok(existsSync(smokeFilePath), 'gemini-smoke-output.txt should exist');
      assert.ok(result.filesChanged.includes('gemini-smoke-output.txt'), 'filesChanged should include the smoke file');
      
    } finally {
      await env.cleanup();
    }
  });

});
