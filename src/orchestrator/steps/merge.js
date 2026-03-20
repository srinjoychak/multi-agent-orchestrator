/**
 * Step: merge
 *
 * Usage:
 *   node src/orchestrator/index.js merge T1    — merge specific task branch
 *   node src/orchestrator/index.js merge       — merge all accepted tasks
 *
 * ─────────────────────────────────────────────────────────────────
 * GEMINI IMPLEMENTATION TASK
 * ─────────────────────────────────────────────────────────────────
 * Implement stepMerge(projectRoot, taskId) in this file.
 *
 * Logic:
 *   1. Create Orchestrator, initialize({ quiet: true })
 *   2. Load session — assert phase is 'reviewing' or 'assigned'
 *   3. Load tasks from taskManager
 *   4. Determine which tasks to merge:
 *      - If taskId given: merge only that task
 *      - Else: merge all tasks where session.reviews[id].decision === 'accepted'
 *        OR all done tasks if no reviews recorded yet (auto-accept mode)
 *   5. For each task to merge: call orchestrator.merger.mergeBranch(task)
 *   6. Print merge result per task: success or conflict details
 *   7. patchSession: phase = 'merged' once all target tasks are merged
 *   8. Print: "Run 'report' to generate final summary"
 *   9. await orchestrator.comms.destroy()
 *
 * Imports needed:
 *   import { Orchestrator } from '../core.js';
 *   import { loadSession, patchSession } from '../session.js';
 *
 * mergeBranch signature (from src/merger/index.js):
 *   merger.mergeBranch(task) → Promise<{ success, conflicts, task }>
 *
 * Error handling:
 *   - If task not found or not in done state: throw with clear message
 *   - If merge conflict: print conflict details but do NOT throw — let user resolve
 * ─────────────────────────────────────────────────────────────────
 */

export async function stepMerge(projectRoot, taskId) {
  throw new Error('stepMerge not yet implemented. See comments in this file for spec.');
}
