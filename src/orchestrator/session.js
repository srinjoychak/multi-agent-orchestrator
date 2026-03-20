/**
 * Session state helpers.
 *
 * A session tracks the lifecycle of one orchestration run across multiple
 * CLI invocations (decompose → assign → execute → review → merge).
 * State is persisted in .agent-team/session.json between commands.
 */

import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SESSION_FILE = 'session.json';

/**
 * @typedef {Object} SessionReview
 * @property {'accepted'|'rejected'} decision
 * @property {string} [reason]
 * @property {string} at - ISO timestamp
 */

/**
 * @typedef {Object} Session
 * @property {string} sessionId
 * @property {string} projectRoot
 * @property {string} prompt
 * @property {'init'|'decomposed'|'assigned'|'executing'|'reviewing'|'merged'|'complete'} phase
 * @property {Object.<string, SessionReview>} reviews  - keyed by task ID
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Create a new session object (not yet saved).
 * @param {string} projectRoot
 * @param {string} prompt
 * @returns {Session}
 */
export function newSession(projectRoot, prompt) {
  const now = new Date().toISOString();
  return {
    sessionId: `sess-${randomBytes(4).toString('hex')}`,
    projectRoot,
    prompt,
    phase: 'init',
    reviews: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load the current session from disk.
 * @param {string} agentTeamDir - path to .agent-team/
 * @returns {Promise<Session>}
 * @throws if no session exists
 */
export async function loadSession(agentTeamDir) {
  const path = join(agentTeamDir, SESSION_FILE);
  if (!existsSync(path)) {
    throw new Error(
      'No active session. Run "decompose <prompt>" first to start a new session.',
    );
  }
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Save session to disk, updating the updatedAt timestamp.
 * @param {string} agentTeamDir
 * @param {Session} session
 */
export async function saveSession(agentTeamDir, session) {
  const path = join(agentTeamDir, SESSION_FILE);
  const updated = { ...session, updatedAt: new Date().toISOString() };
  await writeFile(path, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Update specific fields on the current session.
 * @param {string} agentTeamDir
 * @param {Partial<Session>} patch
 * @returns {Promise<Session>}
 */
export async function patchSession(agentTeamDir, patch) {
  const session = await loadSession(agentTeamDir);
  return saveSession(agentTeamDir, { ...session, ...patch });
}

/**
 * Record an accept/reject review decision for a task.
 * @param {string} agentTeamDir
 * @param {string} taskId
 * @param {'accepted'|'rejected'} decision
 * @param {string} [reason]
 * @returns {Promise<Session>}
 */
export async function recordReview(agentTeamDir, taskId, decision, reason) {
  const session = await loadSession(agentTeamDir);
  const reviews = {
    ...session.reviews,
    [taskId]: { decision, reason, at: new Date().toISOString() },
  };
  return saveSession(agentTeamDir, { ...session, reviews });
}
