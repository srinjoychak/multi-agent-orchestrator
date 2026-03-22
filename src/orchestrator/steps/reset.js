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
import { rm, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
  }

  console.log('\nReady to start fresh. Run: decompose "your request"');
  return { sessionCleared, tasksCleared };
}
