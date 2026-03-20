import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Merges results from multiple agent worktrees back into the main branch.
 * Collects result files and generates a summary report.
 */
export class ResultMerger {
  /**
   * @param {string} projectRoot - Path to the main git repo
   * @param {string} agentTeamDir - Path to .agent-team directory
   */
  constructor(projectRoot, agentTeamDir) {
    this.projectRoot = projectRoot;
    this.agentTeamDir = agentTeamDir;
    this.resultsDir = join(agentTeamDir, 'results');
  }

  /**
   * Collect all result files from the results directory.
   * @returns {Promise<Object[]>}
   */
  async collectResults() {
    if (!existsSync(this.resultsDir)) return [];

    const files = await readdir(this.resultsDir);
    const results = [];

    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const content = await readFile(join(this.resultsDir, file), 'utf-8');
        results.push(JSON.parse(content));
      } catch {
        // Skip corrupted result files
      }
    }

    return results;
  }

  /**
   * Internal wrapper for execFile to facilitate mocking in tests.
   * @param {string} command
   * @param {string[]} args
   * @param {Object} options
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async _execFile(command, args, options) {
    return execFileAsync(command, args, options);
  }

  /**
   * Merge an agent's branch into the current branch.
   * @param {string} branchName - Branch to merge
   * @returns {Promise<{success: boolean, conflicts: string[], output: string}>}
   */
  async mergeBranch(branchName) {
    try {
      const { stdout } = await this._execFile('git', ['merge', '--no-ff', branchName], {
        cwd: this.projectRoot,
      });
      return { success: true, conflicts: [], output: stdout };
    } catch (error) {
      const output = (error.stdout || '') + (error.stderr || '');
      // Check for merge conflicts
      if (output.includes('CONFLICT')) {
        // Abort the failed merge
        await this._execFile('git', ['merge', '--abort'], { cwd: this.projectRoot }).catch(() => {});

        const conflicts = this._parseConflicts(output);
        return { success: false, conflicts, output };
      }
      throw error;
    }
  }

  /**
   * Merge all completed task branches.
   * @param {import('../types/index.js').Task[]} tasks - Completed tasks with worktree_branch set
   * @returns {Promise<{merged: string[], conflicted: {branch: string, conflicts: string[]}[]}>}
   */
  async mergeAll(tasks) {
    const completedTasks = tasks.filter(
      (t) => t.status === 'done' && t.worktree_branch,
    );

    const merged = [];
    const conflicted = [];

    for (const task of completedTasks) {
      const result = await this.mergeBranch(task.worktree_branch);
      if (result.success) {
        merged.push(task.worktree_branch);
      } else {
        conflicted.push({
          branch: task.worktree_branch,
          conflicts: result.conflicts,
        });
      }
    }

    return { merged, conflicted };
  }

  /**
   * Remove a git worktree and optionally delete the branch.
   * @param {string} worktreePath - Path to the worktree
   * @param {string} [branchName] - Branch to delete after removal
   */
  async cleanupWorktree(worktreePath, branchName) {
    try {
      await this._execFile('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.projectRoot,
      });
    } catch {
      // Worktree may already be gone
    }

    if (branchName) {
      try {
        await this._execFile('git', ['branch', '-D', branchName], {
          cwd: this.projectRoot,
        });
      } catch {
        // Branch may already be gone
      }
    }
  }

  /**
   * Generate a summary report of the orchestration run.
   * @param {import('../types/index.js').Task[]} tasks
   * @param {{merged: string[], conflicted: Object[]}} mergeResult
   * @returns {Promise<string>}
   */
  async generateReport(tasks, mergeResult) {
    const results = await this.collectResults();

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_tasks: tasks.length,
        completed: tasks.filter((t) => t.status === 'done').length,
        failed: tasks.filter((t) => t.status === 'failed').length,
        branches_merged: mergeResult.merged.length,
        branches_conflicted: mergeResult.conflicted.length,
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigned_to: t.assigned_to,
        duration: t.completed_at && t.claimed_at
          ? new Date(t.completed_at) - new Date(t.claimed_at)
          : null,
      })),
      results: results.map((r) => ({
        task_id: r.task_id,
        summary: r.summary,
        files_changed: r.filesChanged,
      })),
      conflicts: mergeResult.conflicted,
    };

    const reportPath = join(this.agentTeamDir, 'report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));

    return this._formatReportText(report);
  }

  // -- Private helpers --

  /**
   * Parse conflict file names from git merge output.
   * @param {string} output
   * @returns {string[]}
   */
  _parseConflicts(output) {
    const conflicts = new Set();
    
    // Pattern 1: CONFLICT (content): Merge conflict in <file>
    const regex1 = /CONFLICT.*?:\s*(?:Merge conflict in\s+)?([^\s]+)/g;
    let match;
    while ((match = regex1.exec(output)) !== null) {
      conflicts.add(match[1].trim());
    }

    // Pattern 2: CONFLICT (modify/delete): <file> deleted in ...
    // This is already covered by regex1 if we stop at the first space
    
    return Array.from(conflicts);
  }

  /**
   * Format the report as human-readable text.
   * @param {Object} report
   * @returns {string}
   */
  _formatReportText(report) {
    const lines = [
      '=== Multi-Agent Orchestration Report ===',
      '',
      `Completed: ${report.summary.completed}/${report.summary.total_tasks} tasks`,
      `Failed: ${report.summary.failed} tasks`,
      `Merged: ${report.summary.branches_merged} branches`,
      `Conflicts: ${report.summary.branches_conflicted} branches`,
      '',
      '--- Task Results ---',
    ];

    for (const task of report.tasks) {
      const dur = task.duration ? ` (${Math.round(task.duration / 1000)}s)` : '';
      lines.push(`  [${task.status}] ${task.id}: ${task.title} → ${task.assigned_to}${dur}`);
    }

    if (report.conflicts.length > 0) {
      lines.push('', '--- Conflicts (need manual resolution) ---');
      for (const c of report.conflicts) {
        lines.push(`  Branch: ${c.branch}`);
        for (const file of c.conflicts) {
          lines.push(`    - ${file}`);
        }
      }
    }

    return lines.join('\n');
  }
}
