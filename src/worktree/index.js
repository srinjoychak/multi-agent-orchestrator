/**
 * Worktree Manager — git worktree lifecycle for agent tasks.
 *
 * Each task gets an isolated branch and directory:
 *   .worktrees/gemini-T1/   branch: agent/gemini/T1
 *   .worktrees/claude-T2/   branch: agent/claude/T2
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  /**
   * @param {string} projectRoot  — absolute path to the git repo root
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.worktreesDir = join(projectRoot, '.worktrees');
  }

  /**
   * Path for a given task's worktree.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {string}
   */
  worktreePath(taskId, agentName) {
    return join(this.worktreesDir, `${agentName}-${taskId}`);
  }

  /**
   * Branch name for a given task.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {string}
   */
  branchName(taskId, agentName) {
    return `agent/${agentName}/${taskId}`;
  }

  /**
   * Create a new git worktree + branch for a task.
   * No-op if the worktree already exists.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {Promise<{path: string, branch: string}>}
   */
  async create(taskId, agentName) {
    const path = this.worktreePath(taskId, agentName);
    const branch = this.branchName(taskId, agentName);

    if (!existsSync(path)) {
      await this._git(['worktree', 'add', path, '-b', branch]);
    }
    return { path, branch };
  }

  /**
   * Get the git diff between the task branch and main.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {Promise<string>}
   */
  async diff(taskId, agentName) {
    const branch = this.branchName(taskId, agentName);
    try {
      const { stdout } = await this._git(['diff', `main...${branch}`]);
      return stdout;
    } catch {
      // Branch may not exist yet or have no commits
      return '';
    }
  }

  /**
   * List files changed in the task branch vs main.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {Promise<string[]>}
   */
  async changedFiles(taskId, agentName) {
    const branch = this.branchName(taskId, agentName);
    try {
      const { stdout } = await this._git(['diff', '--name-only', `main...${branch}`]);
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Merge a task branch into the current branch (main).
   * @param {string} taskId
   * @param {string} agentName
   * @returns {Promise<{success: boolean, conflicts: boolean, message: string}>}
   */
  async merge(taskId, agentName) {
    const branch = this.branchName(taskId, agentName);
    try {
      await this._git(['merge', '--no-ff', branch, '-m', `Merge task ${taskId} from ${agentName}`]);
      return { success: true, conflicts: false, message: `Merged ${branch}` };
    } catch (err) {
      if (err.message.includes('CONFLICT') || err.stdout?.includes('CONFLICT')) {
        return { success: false, conflicts: true, message: err.stdout || err.message };
      }
      throw err;
    }
  }

  /**
   * Remove a worktree and delete its branch.
   * @param {string} taskId
   * @param {string} agentName
   */
  async prune(taskId, agentName) {
    const path = this.worktreePath(taskId, agentName);
    const branch = this.branchName(taskId, agentName);

    // Remove worktree (force — handles uncommitted changes)
    try {
      await this._git(['worktree', 'remove', '--force', path]);
    } catch {
      // If git worktree remove fails, clean up the directory manually
      if (existsSync(path)) {
        await rm(path, { recursive: true, force: true });
        await this._git(['worktree', 'prune']).catch(() => {});
      }
    }

    // Delete the branch
    try {
      await this._git(['branch', '-D', branch]);
    } catch {
      // Branch may not exist or already deleted
    }
  }

  /**
   * Remove ALL agent worktrees and branches.
   * Used for hard reset.
   */
  async reset() {
    // Get all worktrees
    const { stdout } = await this._git(['worktree', 'list', '--porcelain']).catch(() => ({ stdout: '' }));
    const worktreePaths = stdout
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.replace('worktree ', '').trim())
      .filter(p => p !== this.projectRoot && p.includes('.worktrees'));

    for (const path of worktreePaths) {
      try {
        await this._git(['worktree', 'remove', '--force', path]);
      } catch {
        if (existsSync(path)) {
          await rm(path, { recursive: true, force: true });
        }
      }
    }
    await this._git(['worktree', 'prune']).catch(() => {});

    // Delete all agent/* branches
    const { stdout: branchOut } = await this._git(['branch', '--list', 'agent/*']).catch(() => ({ stdout: '' }));
    const branches = branchOut.split('\n').map(b => b.trim()).filter(Boolean);
    for (const branch of branches) {
      await this._git(['branch', '-D', branch]).catch(() => {});
    }
  }

  /**
   * Run a git command in the project root.
   * @param {string[]} args
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  _git(args) {
    return execFileAsync('git', args, { cwd: this.projectRoot });
  }
}
