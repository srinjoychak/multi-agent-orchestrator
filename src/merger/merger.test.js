import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { ResultMerger } from './index.js';

async function makeTestEnv() {
  const rootDir = join(tmpdir(), `merger-test-${randomUUID()}`);
  const teamDir = join(rootDir, '.agent-team');
  const resultsDir = join(teamDir, 'results');
  
  await mkdir(resultsDir, { recursive: true });
  const merger = new ResultMerger(rootDir, teamDir);
  
  return {
    rootDir,
    teamDir,
    resultsDir,
    merger,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
}

describe('ResultMerger', () => {
  describe('collectResults()', () => {
    it('returns [] when results directory does not exist', async () => {
      const merger = new ResultMerger('/tmp/none', '/tmp/none/.agent-team');
      const results = await merger.collectResults();
      assert.deepEqual(results, []);
    });

    it('reads and parses all .json files, skips others', async () => {
      const env = await makeTestEnv();
      try {
        await writeFile(join(env.resultsDir, 'T1.json'), JSON.stringify({ task_id: 'T1', summary: 'S1' }));
        await writeFile(join(env.resultsDir, 'T2.json'), JSON.stringify({ task_id: 'T2', summary: 'S2' }));
        await writeFile(join(env.resultsDir, 'other.txt'), 'not json');
        
        const results = await env.merger.collectResults();
        assert.equal(results.length, 2);
        const ids = results.map(r => r.task_id).sort();
        assert.deepEqual(ids, ['T1', 'T2']);
      } finally {
        await env.cleanup();
      }
    });

    it('silently skips corrupted JSON files', async () => {
      const env = await makeTestEnv();
      try {
        await writeFile(join(env.resultsDir, 'T1.json'), 'invalid json');
        await writeFile(join(env.resultsDir, 'T2.json'), JSON.stringify({ task_id: 'T2' }));
        
        const results = await env.merger.collectResults();
        assert.equal(results.length, 1);
        assert.equal(results[0].task_id, 'T2');
      } finally {
        await env.cleanup();
      }
    });
  });

  describe('mergeBranch()', () => {
    it('returns success when git exits 0', async () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      mock.method(merger, '_execFile', async () => ({ stdout: 'Already up to date', stderr: '' }));
      
      const res = await merger.mergeBranch('agent-branch');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.conflicts.length, 0);
      assert.ok(res.output.includes('Already up to date'));
    });

    it('returns failure and conflicts when CONFLICT in output', async () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      const conflictOutput = 'CONFLICT (content): Merge conflict in src/foo.js\nAutomatic merge failed; fix conflicts and then commit the result.';
      
      mock.method(merger, '_execFile', async (cmd, args) => {
        if (args.includes('merge')) {
          const err = new Error('Command failed');
          err.stdout = conflictOutput;
          throw err;
        }
        return { stdout: 'aborted', stderr: '' }; // for git merge --abort
      });
      
      const res = await merger.mergeBranch('agent-branch');
      assert.strictEqual(res.success, false);
      assert.deepEqual(res.conflicts, ['src/foo.js']);
    });
  });

  describe('mergeAll()', () => {
    it('only attempts merge for done tasks with worktree_branch', async () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      const tasks = [
        { status: 'done', worktree_branch: 'b1' },
        { status: 'failed', worktree_branch: 'b2' },
        { status: 'done', worktree_branch: null },
        { status: 'pending', worktree_branch: 'b3' }
      ];

      let mergeCalls = 0;
      mock.method(merger, 'mergeBranch', async () => {
        mergeCalls++;
        return { success: true, conflicts: [], output: '' };
      });

      const res = await merger.mergeAll(tasks);
      assert.equal(mergeCalls, 1);
      assert.deepEqual(res.merged, ['b1']);
      assert.deepEqual(res.conflicted, []);
    });

    it('accumulates merged and conflicted arrays correctly', async () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      const tasks = [
        { status: 'done', worktree_branch: 'ok' },
        { status: 'done', worktree_branch: 'bad' }
      ];

      mock.method(merger, 'mergeBranch', async (branch) => {
        if (branch === 'ok') return { success: true, conflicts: [], output: '' };
        return { success: false, conflicts: ['file.js'], output: '' };
      });

      const res = await merger.mergeAll(tasks);
      assert.deepEqual(res.merged, ['ok']);
      assert.deepEqual(res.conflicted, [{ branch: 'bad', conflicts: ['file.js'] }]);
    });
  });

  describe('cleanupWorktree()', () => {
    it('calls git commands and does not throw if they fail', async () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      let calls = [];
      mock.method(merger, '_execFile', async (cmd, args) => {
        calls.push(args.join(' '));
        if (args.includes('remove')) throw new Error('gone');
        return { stdout: '', stderr: '' };
      });

      await merger.cleanupWorktree('/path/to/wt', 'branch-to-del');
      assert.ok(calls.some(c => c.includes('worktree remove /path/to/wt')));
      assert.ok(calls.some(c => c.includes('branch -D branch-to-del')));
    });
  });

  describe('generateReport()', () => {
    it('writes report.json and returns formatted text', async () => {
      const env = await makeTestEnv();
      try {
        const tasks = [{ id: 'T1', title: 'Task 1', status: 'done', assigned_to: 'agent' }];
        const mergeResult = { merged: ['branch1'], conflicted: [] };
        
        const reportText = await env.merger.generateReport(tasks, mergeResult);
        
        assert.ok(reportText.includes('Task 1'));
        assert.ok(reportText.includes('Merged: 1 branches'));
        
        const reportJson = JSON.parse(await readFile(join(env.teamDir, 'report.json'), 'utf-8'));
        assert.equal(reportJson.summary.total_tasks, 1);
        assert.equal(reportJson.summary.branches_merged, 1);
      } finally {
        await env.cleanup();
      }
    });
  });

  describe('_parseConflicts()', () => {
    it('extracts file names from various conflict patterns', () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      const output = `
        CONFLICT (content): Merge conflict in src/foo.js
        CONFLICT (add/add): Merge conflict in docs/README.md
        CONFLICT (modify/delete): src/bar.js deleted in HEAD and modified in branch.
      `;
      const conflicts = merger._parseConflicts(output);
      assert.deepEqual(conflicts, ['src/foo.js', 'docs/README.md', 'src/bar.js']);
    });

    it('returns [] when no conflicts in output', () => {
      const merger = new ResultMerger('/tmp', '/tmp/.agent-team');
      assert.deepEqual(merger._parseConflicts('Everything merged fine.'), []);
    });
  });
});

import { readFile } from 'node:fs/promises';
