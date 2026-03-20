/**
 * Step: status
 *
 * Usage: node src/orchestrator/index.js status
 *
 * ─────────────────────────────────────────────────────────────────
 * GEMINI IMPLEMENTATION TASK
 * ─────────────────────────────────────────────────────────────────
 * Implement stepStatus(projectRoot) in this file.
 *
 * Logic:
 *   1. Load session via loadSession(agentTeamDir) — if none, print "No active session"
 *   2. Load tasks from TaskManager
 *   3. Print a formatted status board:
 *
 *      Session: sess-abc123   Phase: executing
 *      Prompt:  "Build a REST API with auth and tests"
 *      ────────────────────────────────────────────────────
 *      T1  [code]      Add auth middleware      done      claude-code
 *      T2  [test]      Write auth tests         done      gemini
 *      T3  [refactor]  Protect routes           in_prog   claude-code
 *      ────────────────────────────────────────────────────
 *      Summary: 2 done, 1 in_progress, 0 pending, 0 failed
 *
 *   4. For each done task, show review decision from session.reviews if present:
 *        [accepted] or [rejected: reason]
 *   5. Print next available actions based on phase:
 *      - If tasks are done and not yet reviewed: "accept/reject <taskId>"
 *      - If all accepted: "merge <taskId>"
 *      - If all merged: "report"
 *   6. Does NOT need to initialize() the full orchestrator (no CLI probing needed)
 *      Just needs: new Orchestrator(root).taskManager + session loading
 *
 * Imports needed:
 *   import { join } from 'node:path';
 *   import { resolve } from 'node:path';
 *   import { TaskManager } from '../../taskmanager/index.js';
 *   import { loadSession } from '../session.js';
 *
 * Error handling:
 *   - If no session.json, print friendly message and exit 0 (not an error)
 * ─────────────────────────────────────────────────────────────────
 */

export async function stepStatus(projectRoot) {
  throw new Error('stepStatus not yet implemented. See comments in this file for spec.');
}
