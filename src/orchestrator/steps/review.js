/**
 * Step: review
 *
 * Usage:
 *   node src/orchestrator/index.js review           — review all done tasks
 *   node src/orchestrator/index.js review T1        — review one specific task
 *
 * Shows detailed per-task output and review decisions.
 * Unlike `status` (a compact board), `review` is designed for
 * inspecting task results before accept/reject decisions.
 */

import { join, resolve } from 'node:path';
import { TaskManager } from '../../taskmanager/index.js';
import { loadSession } from '../session.js';

/**
 * @param {string} projectRoot
 * @param {string} [taskId] - If provided, review only this task
 * @returns {Promise<{tasks: Object[], session: Object}|null>}
 */
export async function stepReview(projectRoot, taskId) {
  const root = resolve(projectRoot);
  const agentTeamDir = join(root, '.agent-team');

  let session;
  try {
    session = await loadSession(agentTeamDir);
  } catch {
    console.log('No active session. Start with: decompose "your request"');
    return null;
  }

  const taskManager = new TaskManager(agentTeamDir);
  let tasks = [];
  try {
    await taskManager.initialize();
    tasks = await taskManager.getTasks();
  } catch {
    console.log('No tasks found. Run: assign');
    return null;
  }

  // Filter to requested task or all reviewable tasks
  let targets;
  if (taskId) {
    const found = tasks.find((t) => t.id === taskId);
    if (!found) {
      throw new Error(`Task ${taskId} not found`);
    }
    targets = [found];
  } else {
    // Show done tasks first, then others
    targets = [
      ...tasks.filter((t) => t.status === 'done'),
      ...tasks.filter((t) => t.status !== 'done'),
    ];
  }

  console.log('');
  console.log(`Session : ${session.sessionId}   Phase: ${session.phase}`);
  console.log(`Prompt  : "${session.prompt}"`);
  console.log('');

  for (const task of targets) {
    const review = session.reviews?.[task.id];
    const reviewLine = review
      ? review.decision === 'accepted'
        ? `  Review   : ✓ accepted  (${review.at})`
        : `  Review   : ✗ rejected${review.reason ? ` — ${review.reason}` : ''}  (${review.at})`
      : '  Review   : (none)';

    console.log('─'.repeat(72));
    console.log(`  Task     : ${task.id}  [${task.type || '?'}]  ${task.title}`);
    console.log(`  Status   : ${task.status}${task.assigned_to ? `  (agent: ${task.assigned_to})` : ''}`);
    if (task.worktree_branch) {
      console.log(`  Branch   : ${task.worktree_branch}`);
    }
    if (task.summary) {
      console.log(`  Summary  : ${task.summary}`);
    }
    if (task.result_ref) {
      console.log(`  Result   : ${task.result_ref}`);
    }
    if (task.retry_count > 0) {
      console.log(`  Retries  : ${task.retry_count}/${task.max_retries}`);
    }
    console.log(reviewLine);
  }

  console.log('─'.repeat(72));

  // Action hints for unreviewed done tasks
  const unreviewed = targets.filter(
    (t) => t.status === 'done' && !session.reviews?.[t.id],
  );
  if (unreviewed.length > 0) {
    const eg = unreviewed[0].id;
    console.log('');
    console.log(`Next: accept ${eg}  |  reject ${eg} "reason"`);
  }

  return { tasks: targets, session };
}
