/**
 * Step: decompose
 *
 * Usage: node src/orchestrator/index.js decompose "Build a REST API with auth"
 *
 * Calls the first available agent to decompose the prompt into a task list,
 * saves tasks to TaskManager, and initialises the session.
 */

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Orchestrator } from '../core.js';
import { newSession, saveSession } from '../session.js';

/**
 * @param {string} projectRoot
 * @param {string} prompt
 */
export async function stepDecompose(projectRoot, prompt) {
  if (!prompt || !prompt.trim()) {
    throw new Error('decompose requires a prompt. Usage: decompose "your request here"');
  }

  const orchestrator = new Orchestrator(projectRoot);
  await orchestrator.initialize({ quiet: false });

  console.log('\nDecomposing request into tasks...');
  const tasks = await orchestrator.decomposeTasks(prompt);

  // Initialise session
  if (!existsSync(orchestrator.agentTeamDir)) {
    await mkdir(orchestrator.agentTeamDir, { recursive: true });
  }
  const session = newSession(projectRoot, prompt);
  session.phase = 'decomposed';
  await saveSession(orchestrator.agentTeamDir, session);

  // Print task list for Tech Lead review
  console.log(`\n✓ Decomposed into ${tasks.length} task(s):\n`);
  for (const task of tasks) {
    const deps = task.depends_on?.length ? ` (depends: ${task.depends_on.join(', ')})` : '';
    console.log(`  ${task.id}  [${task.type || '?'}]  ${task.title}${deps}`);
  }
  console.log('\nReview the tasks above, then run: assign');
  console.log(`Session: ${session.sessionId}`);

  await orchestrator.comms.destroy();
  return tasks;
}
