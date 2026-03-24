/**
 * Step: status
 *
 * Usage: node src/orchestrator/index.js status
 *
 * Shows the current session state board — no CLI probing needed, read-only.
 */

import { join, resolve } from 'node:path';
import { TaskManager } from '../../taskmanager/index.js';
import { loadSession } from '../session.js';

/**
 * @param {string} projectRoot
 * @returns {Promise<{session: Object, tasks: Object[], summary: Object}|null>}
 */
export async function stepStatus(projectRoot) {
  const root = resolve(projectRoot);
  const agentTeamDir = join(root, '.agent-team');

  let session;
  try {
    session = await loadSession(agentTeamDir);
  } catch {
    console.log('No active session. Start with: decompose "your request"');
    return null;
  }

  // Read task state directly — no need to probe CLIs
  const taskManager = new TaskManager(agentTeamDir);
  let tasks = [];
  let summary = { done: 0, in_progress: 0, pending: 0, failed: 0 };
  try {
    await taskManager.initialize();
    tasks = await taskManager.getTasks();
    summary = await taskManager.getSummary();
  } catch {
    // tasks.json may not exist yet (decomposed but no assign yet)
  }

  // ── Status board ──────────────────────────────────────────────────────────
  console.log('');
  console.log(`Session : ${session.sessionId}   Phase: ${session.phase}`);
  console.log(`Prompt  : "${session.prompt}"`);
  console.log('─'.repeat(72));

  for (const task of tasks) {
    const review = session.reviews?.[task.id];
    const reviewStr = review
      ? review.decision === 'accepted'
        ? ' ✓accepted'
        : ` ✗rejected${review.reason ? `: ${review.reason}` : ''}`
      : '';
    const agent = (task.assigned_to || '—').padEnd(12);
    const status = task.status.padEnd(11);
    const type = `[${(task.type || '?').padEnd(8)}]`;
    const title = task.title.slice(0, 32).padEnd(32);
    console.log(`  ${task.id.padEnd(4)} ${type} ${title} ${status} ${agent}${reviewStr}`);
  }

  console.log('─'.repeat(72));
  console.log(
    `  ${summary.done} done, ${summary.in_progress} in_progress, ` +
    `${summary.pending} pending, ${summary.failed} failed`,
  );

  // ── Next action hints based on phase ─────────────────────────────────────
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const unreviewed = doneTasks.filter((t) => !session.reviews?.[t.id]);
  const accepted = doneTasks.filter(
    (t) => session.reviews?.[t.id]?.decision === 'accepted',
  );

  console.log('');
  if (session.phase === 'init' || session.phase === 'decomposed') {
    console.log('Next: assign');
  } else if (session.phase === 'assigned') {
    console.log('Next: execute');
  } else if (unreviewed.length > 0) {
    const eg = unreviewed[0].id;
    console.log(`Next: accept ${eg}  |  reject ${eg} "reason"`);
  } else if (accepted.length > 0 && session.phase !== 'merged') {
    console.log('Next: merge  |  merge <taskId>');
  } else if (session.phase === 'merged') {
    console.log('Next: report');
  }

  return { session, tasks, summary };
}
