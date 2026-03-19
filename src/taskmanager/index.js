import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTask, isValidTransition } from '../types/index.js';

/**
 * Manages the shared task list stored as a JSON file.
 *
 * All mutations go through this class to enforce:
 * - Valid state transitions
 * - File-level locking (prevents race conditions)
 * - Dependency resolution
 */
export class TaskManager {
  /**
   * @param {string} baseDir - Path to .agent-team directory
   */
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.tasksFile = join(baseDir, 'tasks.json');
    this._lockFile = join(baseDir, 'tasks.lock');
  }

  /**
   * Initialize the task list file if it doesn't exist.
   */
  async initialize() {
    if (!existsSync(this.tasksFile)) {
      await writeFile(this.tasksFile, JSON.stringify({ tasks: [] }, null, 2));
    }
  }

  /**
   * Read all tasks.
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async getTasks() {
    const content = await readFile(this.tasksFile, 'utf-8');
    const data = JSON.parse(content);
    return data.tasks || [];
  }

  /**
   * Get a single task by ID.
   * @param {string} taskId
   * @returns {Promise<import('../types/index.js').Task|null>}
   */
  async getTask(taskId) {
    const tasks = await this.getTasks();
    return tasks.find((t) => t.id === taskId) || null;
  }

  /**
   * Add a new task to the list.
   * @param {Partial<import('../types/index.js').Task>} taskData
   * @returns {Promise<import('../types/index.js').Task>}
   */
  async addTask(taskData) {
    return this._withLock(async (tasks) => {
      const task = createTask(taskData);
      tasks.push(task);
      return task;
    });
  }

  /**
   * Add multiple tasks at once.
   * @param {Partial<import('../types/index.js').Task>[]} taskDataList
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async addTasks(taskDataList) {
    return this._withLock(async (tasks) => {
      const newTasks = taskDataList.map((td) => createTask(td));
      tasks.push(...newTasks);
      return newTasks;
    });
  }

  /**
   * Claim a task for an agent. Atomic operation with locking.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {Promise<import('../types/index.js').Task>}
   * @throws {Error} if task is not claimable
   */
  async claimTask(taskId, agentName) {
    return this._withLock(async (tasks) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== 'pending') {
        throw new Error(`Task ${taskId} is ${task.status}, cannot claim`);
      }

      // Check dependencies
      const blocked = this._getBlockingDeps(task, tasks);
      if (blocked.length > 0) {
        throw new Error(
          `Task ${taskId} is blocked by: ${blocked.join(', ')}`,
        );
      }

      task.status = 'claimed';
      task.assigned_to = agentName;
      task.claimed_at = new Date().toISOString();
      return task;
    });
  }

  /**
   * Update task status with validation.
   * @param {string} taskId
   * @param {import('../types/index.js').TaskStatus} newStatus
   * @param {Object} [updates={}] - Additional fields to update
   * @returns {Promise<import('../types/index.js').Task>}
   */
  async updateStatus(taskId, newStatus, updates = {}) {
    return this._withLock(async (tasks) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      if (!isValidTransition(task.status, newStatus)) {
        throw new Error(
          `Invalid transition: ${task.status} → ${newStatus} for task ${taskId}`,
        );
      }

      task.status = newStatus;

      if (newStatus === 'done' || newStatus === 'failed') {
        task.completed_at = new Date().toISOString();
      }

      if (newStatus === 'failed' && task.retries < task.max_retries) {
        // Auto-retry: reset to pending
        task.retries += 1;
        task.status = 'pending';
        task.assigned_to = null;
        task.claimed_at = null;
        task.completed_at = null;
      }

      Object.assign(task, updates);
      return task;
    });
  }

  /**
   * Get all tasks available for claiming (pending, unblocked).
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async getClaimableTasks() {
    const tasks = await this.getTasks();
    return tasks.filter((t) => {
      if (t.status !== 'pending') return false;
      return this._getBlockingDeps(t, tasks).length === 0;
    });
  }

  /**
   * Get task completion summary.
   * @returns {Promise<{total: number, pending: number, in_progress: number, done: number, failed: number}>}
   */
  async getSummary() {
    const tasks = await this.getTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      claimed: tasks.filter((t) => t.status === 'claimed').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      done: tasks.filter((t) => t.status === 'done').length,
      failed: tasks.filter((t) => t.status === 'failed' && t.retries >= t.max_retries).length,
    };
  }

  /**
   * Check if all tasks are complete (done or permanently failed).
   * @returns {Promise<boolean>}
   */
  async isAllComplete() {
    const summary = await this.getSummary();
    return summary.pending === 0 && summary.claimed === 0 && summary.in_progress === 0;
  }

  // -- Private helpers --

  /**
   * Get list of unresolved dependency task IDs.
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').Task[]} allTasks
   * @returns {string[]}
   */
  _getBlockingDeps(task, allTasks) {
    return task.depends_on.filter((depId) => {
      const dep = allTasks.find((t) => t.id === depId);
      return !dep || dep.status !== 'done';
    });
  }

  /**
   * Execute a mutation with file locking.
   * Uses a simple lock file approach for v1.
   *
   * @param {function(import('../types/index.js').Task[]): Promise<*>} mutator
   * @returns {Promise<*>}
   */
  async _withLock(mutator) {
    // Simple file-based locking for v1
    // For production, use proper-lockfile package
    const maxAttempts = 10;
    const retryDelay = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check if locked
        if (existsSync(this._lockFile)) {
          // Check lock age — stale locks older than 30s are broken
          const { mtimeMs } = await import('node:fs').then((fs) =>
            fs.statSync(this._lockFile),
          );
          if (Date.now() - mtimeMs > 30_000) {
            await import('node:fs/promises').then((fs) =>
              fs.unlink(this._lockFile),
            );
          } else {
            await new Promise((r) => setTimeout(r, retryDelay));
            continue;
          }
        }

        // Acquire lock
        await writeFile(this._lockFile, String(process.pid));

        // Read current state
        const content = await readFile(this.tasksFile, 'utf-8');
        const data = JSON.parse(content);
        const tasks = data.tasks || [];

        // Apply mutation
        const result = await mutator(tasks);

        // Write back
        await writeFile(this.tasksFile, JSON.stringify({ tasks }, null, 2));

        // Release lock
        if (existsSync(this._lockFile)) {
          const { unlink: unlinkFile } = await import('node:fs/promises');
          await unlinkFile(this._lockFile);
        }

        return result;
      } catch (error) {
        // Release lock on error
        try {
          if (existsSync(this._lockFile)) {
            const { unlink: unlinkFile } = await import('node:fs/promises');
            await unlinkFile(this._lockFile);
          }
        } catch { /* ignore cleanup errors */ }
        throw error;
      }
    }

    throw new Error('Failed to acquire task lock after maximum attempts');
  }
}
