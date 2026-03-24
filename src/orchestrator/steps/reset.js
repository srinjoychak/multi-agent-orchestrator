/**
 * Step: reset
 *
 * Usage:
 *   node src/orchestrator/index.js reset           — clear session state only
 *   node src/orchestrator/index.js reset --hard    — also clear tasks.json
 *
 * Clears the current session so a new decompose can start fresh.
 * Use --hard to also wipe tasks.json (full slate).
 */

import { join, resolve } from 'node:path';
import { rm, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @param {string} projectRoot
 * @param {boolean} [hard=false] - If true, also removes tasks.json
 * @returns {Promise<{sessionCleared: boolean, tasksCleared: boolean}>}
 */
export async function stepReset(projectRoot, hard = false) {
  const root = resolve(projectRoot);
  const agentTeamDir = join(root, '.agent-team');
  const sessionPath = join(agentTeamDir, 'session.json');
  const tasksPath = join(agentTeamDir, 'tasks.json');
  const worktreesDir = join(root, '.worktrees');

  let sessionCleared = false;
  let tasksCleared = false;

  if (existsSync(sessionPath)) {
    await unlink(sessionPath);
    sessionCleared = true;
    console.log('✓ Session cleared.');
  } else {
    console.log('  No active session to clear.');
  }

  if (hard) {
    if (existsSync(tasksPath)) {
      await unlink(tasksPath);
      tasksCleared = true;
      console.log('✓ Tasks cleared (--hard).');
    } else {
      console.log('  No tasks file to clear.');
    }

    // Prune abandoned worktrees and branches
    if (existsSync(worktreesDir)) {
      try {
        const entries = await readdir(worktreesDir);
        for (const entry of entries) {
          const worktreePath = join(worktreesDir, entry);
          console.log(`  Pruning worktree: ${entry}...`);
          try {
            await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: root });
          } catch { /* ignore */ }
        }
        await rm(worktreesDir, { recursive: true, force: true });
        console.log('✓ Worktrees pruned.');
      } catch (error) {
        console.warn(`  Failed to prune worktrees: ${error.message}`);
      }
    }

    // Prune agent branches
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--list', 'agent/*'], { cwd: root });
      const branches = stdout.split('\n').map((b) => b.trim()).filter(Boolean);
      for (const branch of branches) {
        const name = branch.replace(/^\* /, '');
        console.log(`  Deleting branch: ${name}...`);
        try {
          await execFileAsync('git', ['branch', '-D', name], { cwd: root });
        } catch { /* ignore */ }
      }
      if (branches.length > 0) console.log('✓ Agent branches deleted.');
    } catch { /* ignore */ }
  }

  console.log('\nReady to start fresh. Run: decompose "your request"');
  return { sessionCleared, tasksCleared };
}
