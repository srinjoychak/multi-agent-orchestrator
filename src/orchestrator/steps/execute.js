/**
 * Step: execute
 *
 * Usage:
 *   node src/orchestrator/index.js execute          — run all in_progress tasks
 *   node src/orchestrator/index.js execute T1       — run specific task by ID
 */

import { Orchestrator } from '../core.js';
import { loadSession, patchSession } from '../session.js';

/**
 * @param {string} projectRoot
 * @param {string} [taskId] - If provided, run only this task
 */
export async function stepExecute(projectRoot, taskId) {
  const orchestrator = new Orchestrator(projectRoot);
  await orchestrator.initialize({ quiet: true });

  const session = await loadSession(orchestrator.agentTeamDir);

  if (!['assigned', 'executing'].includes(session.phase)) {
    throw new Error(
      `Cannot execute in phase "${session.phase}". Run assign first.`,
    );
  }

  await patchSession(orchestrator.agentTeamDir, { phase: 'executing' });

  if (taskId) {
    // Run a single task by ID
    const allTasks = await orchestrator.taskManager.getTasks();
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    console.log(`\nExecuting ${taskId}...`);
    await orchestrator._runTask(task);
  } else {
    // Run all assigned tasks in dependency-aware waves
    console.log('\nExecuting all assigned tasks...');
    await orchestrator.executeTasks();
  }

  // Refresh and report results
  const allTasks = await orchestrator.taskManager.getTasks();
  const done = allTasks.filter((t) => t.status === 'done');
  const failed = allTasks.filter((t) => t.status === 'failed');

  console.log('\nResults:');
  console.log('─'.repeat(60));
  for (const task of allTasks) {
    if (['done', 'failed'].includes(task.status)) {
      const icon = task.status === 'done' ? '✓' : '✗';
      console.log(`  ${icon} ${task.id}  ${task.status.padEnd(8)} ${task.title}`);
    }
  }
  console.log('─'.repeat(60));
  console.log(`  ${done.length} done, ${failed.length} failed`);

  // Advance session phase if all complete
  const allComplete = await orchestrator.taskManager.isAllComplete();
  if (allComplete) {
    await patchSession(orchestrator.agentTeamDir, { phase: 'reviewing' });
    console.log('\nAll tasks complete. Review results:');
    console.log('  status                     — view full status board');
    console.log('  accept <taskId>            — approve a task result');
    console.log('  reject <taskId> "reason"   — reject with feedback for retry');
  } else {
    console.log('\nSome tasks still in progress or pending. Run: status');
  }

  await orchestrator.comms.destroy();
  return allTasks;
}
