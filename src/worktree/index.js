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
import { rm, readFile, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  /**
   * @param {string} projectRoot  — absolute path to the git repo root
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.worktreesDir = join(projectRoot, '.worktrees');
    this._baseBranch = null; // lazily resolved
  }

  /**
   * Resolve the base branch (main or master) once and cache it.
   * @returns {Promise<string>}
   */
  async _getBaseBranch() {
    if (this._baseBranch) return this._baseBranch;
    try {
      const { stdout } = await this._git(['branch', '--list', 'main']);
      this._baseBranch = stdout.trim() ? 'main' : 'master';
    } catch {
      this._baseBranch = 'master';
    }
    return this._baseBranch;
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

    if (existsSync(path)) {
      // Worktree directory exists from a prior run — clean untracked/modified
      // files so stale artifacts don't pollute the new task's commit.
      await this._gitIn(path, ['checkout', '.']).catch(() => {});
      await this._gitIn(path, ['clean', '-fd']).catch(() => {});
    } else {
      const base = await this._getBaseBranch();
      // Delete stale branch if it exists without a worktree (from a prior failed run)
      await this._git(['branch', '-D', branch]).catch(() => {});
      // Always branch from the base (master/main) so task diffs are clean
      await this._git(['worktree', 'add', path, '-b', branch, base]);
      // On WSL with /mnt/d/ paths, git writes Windows-style paths (D:/) into
      // the worktree's .git file and .git/worktrees/ metadata. Patch them to
      // use POSIX WSL paths so all subsequent git commands work correctly.
      await this._fixWslPaths(path, branch);
    }
    return { path, branch };
  }

  /**
   * Rewrite any Windows-style drive paths (D:/) in worktree git metadata
   * to their WSL equivalents (/mnt/d/). No-op on native Linux.
   * @param {string} worktreePath
   * @param {string} branch
   */
  async _fixWslPaths(worktreePath, branch) {
    const winDriveRe = /([A-Za-z]):\//g;
    const toWsl = (s) => s.replace(winDriveRe, (_, d) => `/mnt/${d.toLowerCase()}/`);

    // 1) Fix <worktree>/.git (plain file pointing at the main repo's worktree entry)
    const dotGit = join(worktreePath, '.git');
    try {
      const content = await readFile(dotGit, 'utf8');
      if (winDriveRe.test(content)) {
        winDriveRe.lastIndex = 0; // reset after .test()
        await writeFile(dotGit, toWsl(content), 'utf8');
      }
    } catch { /* not a file worktree or already gone */ }

    // 2) Fix .git/worktrees/<name>/gitdir  (points back at <worktree>/.git)
    //    and .git/worktrees/<name>/commondir (points at main .git)
    const worktreeName = branch.replace(/\//g, '-'); // agent/gemini/T1 → agent-gemini-T1
    const metaDir = join(this.projectRoot, '.git', 'worktrees', worktreeName);
    for (const file of ['gitdir', 'commondir']) {
      const p = join(metaDir, file);
      try {
        const content = await readFile(p, 'utf8');
        if (winDriveRe.test(content)) {
          winDriveRe.lastIndex = 0;
          await writeFile(p, toWsl(content), 'utf8');
        }
      } catch { /* metadata dir may not exist */ }
    }
  }

  /**
   * Get the git diff between the task branch and main.
   * @param {string} taskId
   * @param {string} agentName
   * @returns {Promise<string>}
   */
  async diff(taskId, agentName) {
    const branch = this.branchName(taskId, agentName);
    const base = await this._getBaseBranch();
    try {
      const { stdout } = await this._git(['diff', `${base}...${branch}`]);
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
    const base = await this._getBaseBranch();
    try {
      const { stdout } = await this._git(['diff', '--name-only', `${base}...${branch}`]);
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
    const base = await this._getBaseBranch();
    // Switch to base branch before merging, then return to current branch
    let originalBranch = '';
    try {
      const { stdout } = await this._git(['rev-parse', '--abbrev-ref', 'HEAD']);
      originalBranch = stdout.trim();
    } catch { /* ignore */ }

    try {
      if (originalBranch !== base) {
        await this._git(['checkout', base]);
      }
      await this._git(['merge', '--no-ff', branch, '-m', `Merge task ${taskId} from ${agentName}`]);
      return { success: true, conflicts: false, message: `Merged ${branch} into ${base}` };
    } catch (err) {
      if (err.message.includes('CONFLICT') || err.stdout?.includes('CONFLICT')) {
        return { success: false, conflicts: true, message: err.stdout || err.message };
      }
      throw err;
    } finally {
      // Return to original branch if we switched
      if (originalBranch && originalBranch !== base) {
        await this._git(['checkout', originalBranch]).catch(() => {});
      }
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

  _gitIn(dir, args) {
    return execFileAsync('git', args, { cwd: dir });
  }
}
