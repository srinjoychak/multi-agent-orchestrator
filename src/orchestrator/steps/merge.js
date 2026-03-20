/**
 * Step: merge
 *
 * Usage:
 *   node src/orchestrator/index.js merge           — merge all accepted tasks
 *   node src/orchestrator/index.js merge T1        — merge specific task branch
 */

import { Orchestrator } from '../core.js';
import { loadSession, patchSession } from '../session.js';

/**
 * @param {string} projectRoot
 * @param {string} [taskId] - If provided, merge only this task's branch
 */
export async function stepMerge(projectRoot, taskId) {
  const orchestrator = new Orchestrator(projectRoot);
  await orchestrator.initialize({ quiet: true });

  const session = await loadSession(orchestrator.agentTeamDir);
  const allTasks = await orchestrator.taskManager.getTasks();

  // Determine which tasks to merge
  let tasksToMerge;
  if (taskId) {
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== 'done') {
      throw new Error(`Task ${taskId} is not done (status: ${task.status})`);
    }
    tasksToMerge = [task];
  } else {
    const hasReviews = Object.keys(session.reviews || {}).length > 0;
    if (hasReviews) {
      // Explicit review mode: only merge accepted tasks
      tasksToMerge = allTasks.filter(
        (t) => t.status === 'done' &&
               t.worktree_branch &&
               session.reviews?.[t.id]?.decision === 'accepted',
      );
    } else {
      // Auto-accept mode: merge all done tasks (no reviews recorded)
      tasksToMerge = allTasks.filter(
        (t) => t.status === 'done' && t.worktree_branch,
      );
    }
  }

  if (tasksToMerge.length === 0) {
    console.log(
      'No tasks eligible for merge.\n' +
      'Accept tasks first with: accept <taskId>',
    );
    await orchestrator.comms.destroy();
    return { merged: 0, conflicted: 0 };
  }

  console.log(`\nMerging ${tasksToMerge.length} branch(es)...\n`);

  let mergedCount = 0;
  let conflictedCount = 0;

  for (const task of tasksToMerge) {
    if (!task.worktree_branch) {
      console.log(`  ${task.id}: no branch to merge (skipped)`);
      continue;
    }

    process.stdout.write(`  ${task.id} (${task.worktree_branch})... `);
    const result = await orchestrator.merger.mergeBranch(task.worktree_branch);

    if (result.success) {
      console.log('✓ merged');
      mergedCount++;
    } else {
      console.log(`✗ CONFLICT in: ${result.conflicts.join(', ')}`);
      console.log('    Resolve conflicts manually, commit, then run merge again.');
      conflictedCount++;
    }
  }

  console.log(`\n${mergedCount} merged, ${conflictedCount} conflicts.`);

  if (conflictedCount === 0) {
    await patchSession(orchestrator.agentTeamDir, { phase: 'merged' });
    console.log("Run 'report' to generate the final summary.");
  } else {
    console.log('Resolve conflicts, then run merge again.');
  }

  await orchestrator.comms.destroy();
  return { merged: mergedCount, conflicted: conflictedCount };
}
