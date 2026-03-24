/**
 * Step: assign
 *
 * Usage: node src/orchestrator/index.js assign
 *
 * Reads pending tasks from TaskManager, assigns each to an agent based on
 * capability matching, updates task state to in_progress, and advances the session.
 */

import { Orchestrator } from '../core.js';
import { loadSession, patchSession } from '../session.js';

/**
 * @param {string} projectRoot
 */
export async function stepAssign(projectRoot) {
  // Load session — must have run decompose first
  const orchestrator = new Orchestrator(projectRoot);
  await orchestrator.initialize({ quiet: true });

  const session = await loadSession(orchestrator.agentTeamDir);

  if (!['decomposed', 'assigned'].includes(session.phase)) {
    throw new Error(
      `Cannot assign in phase "${session.phase}". Run decompose first.`,
    );
  }

  // Get pending tasks from TaskManager (source of truth)
  const allTasks = await orchestrator.taskManager.getTasks();
  const pending = allTasks.filter((t) => t.status === 'pending');

  if (pending.length === 0) {
    console.log('No pending tasks to assign. All tasks are already assigned or complete.');
    await orchestrator.comms.destroy();
    return [];
  }

  console.log(`\nAssigning ${pending.length} task(s)...\n`);
  await orchestrator.assignTasks(pending);

  await patchSession(orchestrator.agentTeamDir, { phase: 'assigned' });

  // Print assignment summary
  const assigned = await orchestrator.taskManager.getTasks();
  console.log('\nAssignment plan:');
  console.log('─'.repeat(60));
  for (const task of assigned) {
    if (task.assigned_to) {
      console.log(`  ${task.id}  →  ${task.assigned_to}  [${task.type || '?'}]  ${task.title}`);
    }
  }
  console.log('─'.repeat(60));
  console.log('\nReview the assignment above, then run:');
  console.log('  execute          — run all assigned tasks in parallel');
  console.log('  execute <taskId> — run a single task');

  await orchestrator.comms.destroy();
  return assigned.filter((t) => t.assigned_to);
}
