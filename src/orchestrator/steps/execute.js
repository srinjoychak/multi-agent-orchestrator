/**
 * Step: execute
 *
 * Usage:
 *   node src/orchestrator/index.js execute          — run all in_progress tasks
 *   node src/orchestrator/index.js execute T1       — run specific task by ID
 *
 * ─────────────────────────────────────────────────────────────────
 * GEMINI IMPLEMENTATION TASK
 * ─────────────────────────────────────────────────────────────────
 * Implement stepExecute(projectRoot, taskId) in this file.
 *
 * Logic:
 *   1. Create Orchestrator, initialize({ quiet: true })
 *   2. Load session — assert phase is 'assigned' or 'executing'
 *   3. If taskId provided: call orchestrator.executeTask(taskId)
 *      Else: call orchestrator.executeTasks() (runs all in_progress in waves)
 *   4. patchSession: phase = 'executing' (or 'reviewing' if all complete)
 *   5. Print results: task ID, status (done/failed), summary snippet
 *   6. After all tasks done, print:
 *        "Review results with: status"
 *        "Accept a task with: accept <taskId>"
 *        "Reject a task with: reject <taskId> \"reason\""
 *   7. await orchestrator.comms.destroy()
 *
 * Imports needed:
 *   import { Orchestrator } from '../core.js';
 *   import { loadSession, patchSession } from '../session.js';
 *
 * Error handling:
 *   - Throw if session phase is incompatible
 *   - Throw if taskId is given but task not found
 *   - Never swallow errors — let the CLI handler print them
 * ─────────────────────────────────────────────────────────────────
 */

export async function stepExecute(projectRoot, taskId) {
  throw new Error('stepExecute not yet implemented. See comments in this file for spec.');
}
