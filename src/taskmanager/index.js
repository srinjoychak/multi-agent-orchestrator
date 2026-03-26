/**
 * Task Manager — SQLite-backed task state machine.
 *
 * Replaces the JSON+lockfile implementation with better-sqlite3,
 * giving ACID transactions and concurrent-write safety for parallel workers.
 *
 * State machine:
 *   pending -> claimed -> in_progress -> done
 *                  |            |
 *                  v            v
 *               pending      failed -> pending (retry, up to max_retries)
 *
 * Rejection re-queues: done -> pending (with rejection reason appended).
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

const VALID_TYPES = new Set(['code', 'refactor', 'test', 'review', 'debug', 'research', 'docs', 'analysis']);
const VALID_STATUSES = new Set(['pending', 'claimed', 'in_progress', 'done', 'failed']);

const VALID_TRANSITIONS = new Map([
  ['pending',     new Set(['claimed'])],
  ['claimed',     new Set(['in_progress', 'pending'])],
  ['in_progress', new Set(['done', 'failed'])],
  ['done',        new Set(['pending'])],
  ['failed',      new Set(['pending'])],
]);

export class TaskManager {
  /** @param {string} stateDir — directory where tasks.db will be stored */
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.dbPath = join(stateDir, 'tasks.db');
    /** @type {import('better-sqlite3').Database|null} */
    this.db = null;
  }

  /** Initialize: create state directory and open the SQLite database. */
  async initialize() {
    try {
      if (!existsSync(this.stateDir)) {
        await mkdir(this.stateDir, { recursive: true });
      }
      console.error(`[taskmanager] Opening database at ${this.dbPath}`);
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));
    } catch (err) {
      console.error(`[taskmanager] FAILED to initialize database: ${err.message}`);
      throw err;
    }
  }

  /**
   * Add a single task.
   * @param {Object} taskData
   * @returns {Object}
   */
  async addTask(taskData) {
    const task = this._normalise(taskData);
    this.db.prepare(`
      INSERT INTO tasks (id, title, description, type, status, depends_on, max_retries)
      VALUES (@id, @title, @description, @type, 'pending', @depends_on, @max_retries)
    `).run({
      id: task.id,
      title: task.title,
      description: task.description ?? '',
      type: task.type,
      depends_on: JSON.stringify(task.depends_on ?? []),
      max_retries: task.max_retries ?? 1,
    });
    return this.getTask(task.id);
  }

  /**
   * Add multiple tasks in a single transaction.
   * @param {Object[]} tasks
   * @returns {Object[]}
   */
  async addTasks(tasks) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO tasks (id, title, description, type, status, depends_on, max_retries)
      VALUES (@id, @title, @description, @type, 'pending', @depends_on, @max_retries)
    `);
    this.db.transaction((rows) => {
      for (const row of rows) {
        const t = this._normalise(row);
        stmt.run({
          id: t.id,
          title: t.title,
          description: t.description ?? '',
          type: t.type,
          depends_on: JSON.stringify(t.depends_on ?? []),
          max_retries: t.max_retries ?? 1,
        });
      }
    })(tasks);
    return this.getTasks();
  }

  /**
   * Get a single task by ID.
   * @param {string} id
   * @returns {Object}
   */
  async getTask(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) throw new Error(`Task ${id} not found`);
    return this._deserialise(row);
  }

  /** Get all tasks. @returns {Object[]} */
  async getTasks() {
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at').all().map(r => this._deserialise(r));
  }

  /**
   * Claim a task (pending -> claimed) for an agent.
   * Uses a transaction to prevent double-claiming.
   */
  async claimTask(taskId, agentName) {
    this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== 'pending') throw new Error(`Task ${taskId} is ${task.status}, cannot claim`);

      // Check dependency blockers
      const deps = JSON.parse(task.depends_on || '[]');
      if (deps.length > 0) {
        for (const depId of deps) {
          const dep = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(depId);
          if (!dep || dep.status !== 'done') {
            throw new Error(`Task ${taskId} is blocked by dependency ${depId}`);
          }
        }
      }

      this.db.prepare(`
        UPDATE tasks SET status='claimed', assigned_to=?, claimed_at=datetime('now')
        WHERE id=? AND status='pending'
      `).run(agentName, taskId);
    })();
    return this.getTask(taskId);
  }

  /**
   * Update a task's status and optional fields.
   * Validates against the state machine.
   */
  async updateStatus(taskId, newStatus, fields = {}) {
    if (!VALID_STATUSES.has(newStatus)) throw new Error(`Invalid status: ${newStatus}`);

    this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      const allowed = VALID_TRANSITIONS.get(task.status);
      if (!allowed?.has(newStatus)) {
        throw new Error(`Invalid transition ${task.status} -> ${newStatus} for task ${taskId}`);
      }

      const setClauses = ['status = @status'];
      const params = { id: taskId, status: newStatus };

      if (newStatus === 'done' || newStatus === 'failed') {
        setClauses.push("completed_at = datetime('now')");
      }
      for (const [key, val] of Object.entries(fields)) {
        if (['worktree_branch','container_id','result_ref','assigned_to'].includes(key)) {
          setClauses.push(`${key} = @${key}`);
          params[key] = val;
        } else if (key === 'token_usage') {
          setClauses.push('token_usage = @token_usage');
          params.token_usage = JSON.stringify(val);
        }
      }
      this.db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

      // Auto-retry on failure if retries < max_retries
      if (newStatus === 'failed') {
        const updated = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (updated.retries < updated.max_retries) {
          const prev = JSON.parse(updated.previous_agents ?? '[]');
          if (updated.assigned_to && !prev.includes(updated.assigned_to)) prev.push(updated.assigned_to);
          this.db.prepare(`
            UPDATE tasks SET status='pending', assigned_to=NULL, claimed_at=NULL,
              completed_at=NULL, container_id=NULL, retries=retries+1, previous_agents=?
            WHERE id=?
          `).run(JSON.stringify(prev), taskId);
        }
      }
    })();
    return this.getTask(taskId);
  }

  /** Reject a completed task: re-queue as pending with reason appended. */
  async rejectTask(taskId, reason) {
    this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== 'done') throw new Error(`Can only reject done tasks, ${taskId} is ${task.status}`);

      const prev = JSON.parse(task.previous_agents ?? '[]');
      if (task.assigned_to && !prev.includes(task.assigned_to)) prev.push(task.assigned_to);

      this.db.prepare(`
        UPDATE tasks SET
          status='pending', assigned_to=NULL, claimed_at=NULL,
          completed_at=NULL, container_id=NULL,
          description=description || '\n\n[REJECTED] ' || ?,
          previous_agents=?
        WHERE id=?
      `).run(reason, JSON.stringify(prev), taskId);
    })();
    return this.getTask(taskId);
  }

  /** Retry a failed task. Returns null if max_retries exceeded. */
  async retryTask(taskId) {
    let result = null;
    this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task || task.status !== 'failed') return;
      if (task.retries >= task.max_retries) return;

      const prev = JSON.parse(task.previous_agents ?? '[]');
      if (task.assigned_to && !prev.includes(task.assigned_to)) prev.push(task.assigned_to);

      this.db.prepare(`
        UPDATE tasks SET status='pending', assigned_to=NULL, claimed_at=NULL,
          completed_at=NULL, container_id=NULL, retries=retries+1, previous_agents=?
        WHERE id=?
      `).run(JSON.stringify(prev), taskId);

      result = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    })();
    return result ? this._deserialise(result) : null;
  }

  /**
   * Get all tasks assigned to a specific agent.
   * @param {string} agentName
   * @returns {Object[]}
   */
  async getTasksByAgent(agentName) {
    return this.db.prepare('SELECT * FROM tasks WHERE assigned_to = ? ORDER BY created_at')
      .all(agentName)
      .map(r => this._deserialise(r));
  }

  /** Reset stale claims (claimed > 10 min ago) back to pending. */
  async resetStaleClaims() {
    this.db.prepare(`
      UPDATE tasks SET status='pending', assigned_to=NULL, claimed_at=NULL
      WHERE status='claimed' AND claimed_at < datetime('now', '-10 minutes')
    `).run();
  }

  /** Check if all tasks are in a terminal state. @returns {boolean} */
  async isAllComplete() {
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM tasks WHERE status NOT IN ('done','failed')
    `).get();
    return row.cnt === 0;
  }

  /** Get status summary. */
  async getSummary() {
    const rows = this.db.prepare('SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status').all();
    const s = { pending: 0, claimed: 0, in_progress: 0, done: 0, failed: 0, total: 0 };
    for (const row of rows) { s[row.status] = row.cnt; s.total += row.cnt; }
    return s;
  }

  /** Get pending tasks whose dependencies are all done. */
  async getClaimableTasks() {
    const tasks = await this.getTasks();
    return tasks.filter(t => {
      if (t.status !== 'pending') return false;
      return t.depends_on.every(dep => tasks.find(x => x.id === dep)?.status === 'done');
    });
  }

  /** Clear all tasks. */
  clear() { this.db.prepare('DELETE FROM tasks').run(); }

  /** Close the database. */
  close() { this.db?.close(); this.db = null; }

  _normalise(data) {
    return {
      ...data,
      id: data.id ?? `T${Date.now()}`,
      title: data.title ?? 'Untitled task',
      type: VALID_TYPES.has(data.type) ? data.type : 'code',
      depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
      max_retries: data.max_retries ?? 1,
    };
  }

  _deserialise(row) {
    return {
      ...row,
      depends_on: this._json(row.depends_on, []),
      previous_agents: this._json(row.previous_agents, []),
      token_usage: this._json(row.token_usage, {}),
    };
  }

  _json(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }
}
