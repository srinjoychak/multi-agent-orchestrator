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
 *
 * v4 additions: jobs table, forced_agent, job-scoped queries, retryDue().
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

/**
 * Versioned idempotent schema migrations.
 * Each key is a version number. Migrations are applied sequentially from
 * (current user_version + 1) up to CURRENT_SCHEMA_VERSION.
 * Never edit an existing migration — add a new numbered entry.
 */
const MIGRATIONS = {
  1: (db) => {
    const existing = new Set(db.pragma('table_info(tasks)').map(c => c.name));
    const cols = [
      ['subagent_name',  'TEXT'],
      ['provider',       'TEXT'],
      ['model',          'TEXT'],
      ['parent_task_id', 'TEXT'],
      ['delegate_depth', 'INTEGER DEFAULT 0'],
      ['is_delegated',   'INTEGER DEFAULT 0'],
      ['routing_reason', 'TEXT'],
      ['result_data',    'TEXT'],
    ];
    for (const [col, type] of cols) {
      if (!existing.has(col)) db.exec(`ALTER TABLE tasks ADD COLUMN ${col} ${type}`);
    }
  },
};

const CURRENT_SCHEMA_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

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
      // Clean up WAL artefacts from unclean shutdowns (common after WSL2 reboot).
      // Stale -shm/-wal files cause "disk I/O error" on next open.
      for (const suffix of ['-shm', '-wal']) {
        const f = this.dbPath + suffix;
        if (existsSync(f)) { try { unlinkSync(f); } catch { /* ignore */ } }
      }
      console.error(`[taskmanager] Opening database at ${this.dbPath}`);
      this.db = new Database(this.dbPath);
      // Use DELETE journal mode — WAL requires shared-memory file locking that
      // is unreliable over WSL2 9p/DrvFs mounts and fragile after unclean shutdown.
      this.db.pragma('journal_mode = DELETE');
      this.db.pragma('foreign_keys = ON');
      this.db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));

      // Apply any pending versioned migrations.
      const dbVersion = this.db.pragma('user_version', { simple: true });
      for (let v = dbVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
        if (MIGRATIONS[v]) {
          console.error(`[taskmanager] Applying migration v${v}`);
          MIGRATIONS[v](this.db);
          this.db.pragma(`user_version = ${v}`);
        }
      }

      // Orphan recovery: delegated tasks that were in_progress when the
      // orchestrator last crashed are permanently failed on next startup.
      // Scoped to is_delegated=1 to avoid interfering with resetStaleClaims().
      const orphaned = this.db.prepare(
        `SELECT id FROM tasks WHERE is_delegated = 1 AND status = 'in_progress'`
      ).all();
      for (const { id } of orphaned) {
        this.db.prepare(
          `UPDATE tasks SET status='failed', completed_at=datetime('now'),
           routing_reason='orchestrator_restart'
           WHERE id=? AND is_delegated=1 AND status='in_progress'`
        ).run(id);
        console.error(`[taskmanager] Orphan recovery: task ${id} marked failed (orchestrator_restart)`);
      }
    } catch (err) {
      console.error(`[taskmanager] FAILED to initialize database: ${err.message}`);
      throw err;
    }
  }

  // ─── Job management ───────────────────────────────────────────────────────

  /**
   * Register a new job.
   * @param {string} jobId — UUID
   * @param {string} prompt
   * @returns {Object}
   */
  addJob(jobId, prompt) {
    this.db.prepare(`
      INSERT INTO jobs (id, prompt) VALUES (?, ?)
    `).run(jobId, prompt);
    return this.getJob(jobId);
  }

  /**
   * Get a job by ID.
   * @param {string} jobId
   * @returns {Object}
   */
  getJob(jobId) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!row) throw new Error(`Job ${jobId} not found`);
    return row;
  }

  /**
   * Mark a job as done or failed.
   * @param {string} jobId
   * @param {'done'|'failed'} status
   */
  finishJob(jobId, status) {
    this.db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId);
  }

  // ─── Task management ──────────────────────────────────────────────────────

  /**
   * Add a single task.
   * @param {Object} taskData
   * @returns {Object}
   */
  async addTask(taskData) {
    const task = this._normalise(taskData);
    this.db.prepare(`
      INSERT INTO tasks (id, job_id, title, description, type, status, depends_on, max_retries, forced_agent,
        subagent_name, provider, model, parent_task_id, delegate_depth, is_delegated, routing_reason, result_data)
      VALUES (@id, @job_id, @title, @description, @type, 'pending', @depends_on, @max_retries, @forced_agent,
        @subagent_name, @provider, @model, @parent_task_id, @delegate_depth, @is_delegated, @routing_reason, @result_data)
    `).run({
      id: task.id,
      job_id: task.job_id ?? null,
      title: task.title,
      description: task.description ?? '',
      type: task.type,
      depends_on: JSON.stringify(task.depends_on ?? []),
      max_retries: task.max_retries ?? 1,
      forced_agent: task.forced_agent ?? null,
      subagent_name: task.subagent_name ?? null,
      provider: task.provider ?? null,
      model: task.model ?? null,
      parent_task_id: task.parent_task_id ?? null,
      delegate_depth: task.delegate_depth ?? 0,
      is_delegated: task.is_delegated ? 1 : 0,
      routing_reason: task.routing_reason ?? null,
      result_data: task.result_data ? JSON.stringify(task.result_data) : null,
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
      INSERT OR IGNORE INTO tasks (id, job_id, title, description, type, status, depends_on, max_retries, forced_agent,
        subagent_name, provider, model, parent_task_id, delegate_depth, is_delegated, routing_reason, result_data)
      VALUES (@id, @job_id, @title, @description, @type, 'pending', @depends_on, @max_retries, @forced_agent,
        @subagent_name, @provider, @model, @parent_task_id, @delegate_depth, @is_delegated, @routing_reason, @result_data)
    `);
    this.db.transaction((rows) => {
      for (const row of rows) {
        const t = this._normalise(row);
        stmt.run({
          id: t.id,
          job_id: t.job_id ?? null,
          title: t.title,
          description: t.description ?? '',
          type: t.type,
          depends_on: JSON.stringify(t.depends_on ?? []),
          max_retries: t.max_retries ?? 1,
          forced_agent: t.forced_agent ?? null,
          subagent_name: t.subagent_name ?? null,
          provider: t.provider ?? null,
          model: t.model ?? null,
          parent_task_id: t.parent_task_id ?? null,
          delegate_depth: t.delegate_depth ?? 0,
          is_delegated: t.is_delegated ? 1 : 0,
          routing_reason: t.routing_reason ?? null,
          result_data: t.result_data ? JSON.stringify(t.result_data) : null,
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
   * Get all tasks for a specific job.
   * @param {string} jobId
   * @returns {Object[]}
   */
  async getJobTasks(jobId) {
    return this.db.prepare('SELECT * FROM tasks WHERE job_id = ? ORDER BY created_at')
      .all(jobId)
      .map(r => this._deserialise(r));
  }

  /**
   * Get pending tasks for a job whose dependencies are all done,
   * and which this agent is allowed to claim (forced_agent check).
   * @param {string} jobId
   * @param {string} agentName
   * @returns {Object[]}
   */
  async getClaimableTasksForJob(jobId, agentName) {
    const tasks = await this.getJobTasks(jobId);
    return tasks.filter(t => {
      if (t.status !== 'pending') return false;
      if (t.queue === 'retry') return false;
      if (t.forced_agent && t.forced_agent !== agentName) return false;
      return t.depends_on.every(dep => tasks.find(x => x.id === dep)?.status === 'done');
    });
  }

  /**
   * Claim a task (pending -> claimed) for an agent.
   * Uses BEGIN IMMEDIATE transaction to prevent double-claiming.
   * Checks forced_agent constraint.
   */
  async claimTask(taskId, agentName) {
    this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== 'pending') throw new Error(`Task ${taskId} is ${task.status}, cannot claim`);

      // Enforce forced_agent constraint
      if (task.forced_agent && task.forced_agent !== agentName) {
        throw new Error(`Task ${taskId} is reserved for ${task.forced_agent}`);
      }

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
        if (['worktree_branch','container_id','result_ref','assigned_to',
             'subagent_name','provider','model','parent_task_id','routing_reason'].includes(key)) {
          setClauses.push(`${key} = @${key}`);
          params[key] = val;
        } else if (key === 'delegate_depth') {
          setClauses.push('delegate_depth = @delegate_depth');
          params.delegate_depth = val;
        } else if (key === 'is_delegated') {
          setClauses.push('is_delegated = @is_delegated');
          params.is_delegated = val ? 1 : 0;
        } else if (key === 'token_usage') {
          setClauses.push('token_usage = @token_usage');
          params.token_usage = JSON.stringify(val);
        } else if (key === 'result_data') {
          setClauses.push('result_data = @result_data');
          params.result_data = val ? JSON.stringify(val) : null;
        }
      }
      this.db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

      // Auto-retry on failure if retries < max_retries
      if (newStatus === 'failed') {
        const updated = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (updated.retries < updated.max_retries) {
          const prev = JSON.parse(updated.previous_agents ?? '[]');
          if (updated.assigned_to && !prev.includes(updated.assigned_to)) prev.push(updated.assigned_to);
          const backoffSecs = Math.pow(2, updated.retries) * 15; // 15s, 30s, 60s...
          this.db.prepare(`
            UPDATE tasks SET status='pending', queue='retry',
              retry_after=datetime('now', '+' || ? || ' seconds'),
              assigned_to=NULL, claimed_at=NULL, completed_at=NULL,
              container_id=NULL, retries=retries+1, previous_agents=?
            WHERE id=?
          `).run(backoffSecs, JSON.stringify(prev), taskId);
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
   * Move tasks from retry queue back to pending if their retry_after has passed.
   * @returns {number} count of tasks re-queued
   */
  retryDue() {
    const result = this.db.prepare(`
      UPDATE tasks SET status='pending', queue='pending', retry_after=NULL
      WHERE queue='retry' AND retry_after <= datetime('now')
    `).run();
    return result.changes;
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

  /**
   * Check if all tasks are in a terminal state.
   * @param {string} [jobId] — if provided, only checks tasks for this job
   * @returns {boolean}
   */
  async isAllComplete(jobId) {
    const where = jobId
      ? "WHERE job_id = ? AND status NOT IN ('done','failed')"
      : "WHERE status NOT IN ('done','failed')";
    const args = jobId ? [jobId] : [];
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM tasks ${where}`).get(...args);
    return row.cnt === 0;
  }

  /**
   * Get status summary.
   * @param {string} [jobId] — if provided, only counts tasks for this job
   */
  async getSummary(jobId) {
    const where = jobId ? 'WHERE job_id = ?' : '';
    const args  = jobId ? [jobId] : [];
    const rows = this.db.prepare(`SELECT status, COUNT(*) as cnt FROM tasks ${where} GROUP BY status`).all(...args);
    const s = { pending: 0, claimed: 0, in_progress: 0, done: 0, failed: 0, total: 0 };
    for (const row of rows) { s[row.status] = row.cnt; s.total += row.cnt; }
    return s;
  }

  /** Get pending tasks whose dependencies are all done. */
  async getClaimableTasks() {
    const tasks = await this.getTasks();
    return tasks.filter(t => {
      if (t.status !== 'pending') return false;
      if (t.queue === 'retry') return false;
      return t.depends_on.every(dep => tasks.find(x => x.id === dep)?.status === 'done');
    });
  }

  /** Clear all tasks. */
  clear() {
    this.db.prepare('DELETE FROM tasks').run();
    this.db.prepare('DELETE FROM jobs').run();
  }

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
      subagent_name: data.subagent_name ?? null,
      provider: data.provider ?? null,
      model: data.model ?? null,
      parent_task_id: data.parent_task_id ?? null,
      delegate_depth: data.delegate_depth ?? 0,
      is_delegated: data.is_delegated ?? false,
      routing_reason: data.routing_reason ?? null,
      result_data: data.result_data ?? null,
    };
  }

  _deserialise(row) {
    return {
      ...row,
      depends_on: this._json(row.depends_on, []),
      previous_agents: this._json(row.previous_agents, []),
      token_usage: this._json(row.token_usage, {}),
      result_data: this._json(row.result_data, null),
      is_delegated: row.is_delegated === 1,
    };
  }

  _json(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }
}
