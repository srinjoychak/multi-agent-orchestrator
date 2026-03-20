#!/usr/bin/env node

/**
 * Multi-Agent Orchestrator
 *
 * Coordinates Claude Code and Gemini CLI working as a team.
 * Decomposes user requests into tasks, assigns to agents,
 * monitors execution, and merges results.
 *
 * Usage:
 *   node src/orchestrator/index.js "Build a REST API with auth and tests"
 *   node src/orchestrator/index.js --tasks tasks.json
 */

import { join, resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TaskManager } from '../taskmanager/index.js';
import { FileCommChannel } from '../comms/file-channel.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { ResultMerger } from '../merger/index.js';
import { AGENTS, MSG_TYPES } from '../types/index.js';

const execFileAsync = promisify(execFile);

/**
 * Main orchestrator class.
 */
export class Orchestrator {
  /**
   * @param {string} projectRoot - Project directory
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=2000] - Status poll interval
   * @param {number} [options.taskTimeoutMs=300000] - Per-task timeout
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = resolve(projectRoot);
    this.agentTeamDir = join(this.projectRoot, '.agent-team');
    this.worktreesDir = join(this.projectRoot, '.worktrees');
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 300_000;

    this.taskManager = new TaskManager(this.agentTeamDir);
    this.comms = new FileCommChannel(this.agentTeamDir);
    this.merger = new ResultMerger(this.projectRoot, this.agentTeamDir);

    this.adapters = new Map();
    this._running = false;
  }

  /**
   * Initialize the orchestrator: check agents, create directories.
   */
  async initialize() {
    console.log('Initializing orchestrator...');

    // Create directories
    for (const dir of [this.agentTeamDir, this.worktreesDir]) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    await this.taskManager.initialize();
    await this.comms.initialize();

    // Detect available adapters
    const candidates = [
      new ClaudeCodeAdapter({ timeoutMs: this.taskTimeoutMs }),
      new GeminiAdapter({ timeoutMs: this.taskTimeoutMs }),
    ];

    for (const adapter of candidates) {
      const available = await adapter.isAvailable();
      if (available) {
        this.adapters.set(adapter.name, adapter);
        console.log(`  [+] ${adapter.name} — available`);
      } else {
        console.log(`  [-] ${adapter.name} — not found, skipping`);
      }
    }

    if (this.adapters.size === 0) {
      throw new Error('No AI agents available. Install claude or gemini CLI.');
    }

    console.log(`  ${this.adapters.size} agent(s) ready.\n`);
  }

  /**
   * Run the full orchestration pipeline.
   * @param {string|import('../types/index.js').Task[]} input - User prompt or pre-loaded tasks
   */
  async run(input) {
    this._running = true;

    try {
      let tasks;
      if (typeof input === 'string') {
        // Step 1: Decompose the user prompt into tasks
        console.log('Step 1: Decomposing request into tasks...');
        tasks = await this.decomposeTasks(input);
      } else {
        tasks = input;
        console.log(`Step 1: Skipped (loaded ${tasks.length} tasks from file).`);
      }
      console.log(`  Working with ${tasks.length} tasks.\n`);

      // Step 2: Assign tasks to agents (round-robin)
      console.log('Step 2: Assigning tasks to agents...');
      await this.assignTasks(tasks);

      // Step 3: Create git worktrees and execute tasks in parallel
      console.log('\nStep 3: Executing tasks in parallel...');
      await this.executeTasks();

      // Step 4: Monitor until all tasks complete
      console.log('\nStep 4: Monitoring progress...');
      await this.monitorUntilComplete();

      // Step 5: Merge results
      console.log('\nStep 5: Merging results...');
      const allTasks = await this.taskManager.getTasks();
      const mergeResult = await this.merger.mergeAll(allTasks);

      // Step 6: Generate report
      console.log('\nStep 6: Generating report...');
      const report = await this.merger.generateReport(allTasks, mergeResult);
      console.log('\n' + report);

      // Step 7: Cleanup worktrees
      await this.cleanup(allTasks);
    } finally {
      this._running = false;
      await this.comms.destroy();
    }
  }

  /**
   * Load tasks from a JSON file instead of decomposing from a prompt.
   * @param {string} filePath - Absolute or relative path to tasks JSON file
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async loadTasksFromFile(filePath) {
    const absolutePath = resolve(filePath);
    if (!existsSync(absolutePath)) {
      console.error(`Error: Tasks file not found: ${absolutePath}`);
      process.exit(1);
    }

    try {
      const content = await readFile(absolutePath, 'utf-8');
      const parsed = JSON.parse(content);
      const taskList = Array.isArray(parsed) ? parsed : (parsed.tasks || []);

      if (!Array.isArray(taskList)) {
        throw new Error('Tasks file must contain an array of tasks or an object with a "tasks" array.');
      }

      return await this.taskManager.addTasks(taskList);
    } catch (error) {
      console.error(`Error parsing tasks file: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Decompose a user prompt into discrete tasks.
   * Uses the first available agent to do the decomposition.
   * @param {string} userPrompt
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async decomposeTasks(userPrompt) {
    // Use the first available adapter to plan tasks
    const planner = this.adapters.values().next().value;

    const planPrompt = [
      'You are a task planner. Break the following request into independent, parallelizable tasks.',
      'Return ONLY a JSON array of task objects with "id", "title", "description", and "depends_on" fields.',
      'Each task should be self-contained and workable by a single agent in its own directory.',
      'Keep tasks focused — each should touch a different set of files.',
      'Do not include any explanation, only the JSON array.',
      '',
      `Request: ${userPrompt}`,
    ].join('\n');

    const planTask = {
      id: 'PLAN',
      title: 'Decompose user request into tasks',
      description: planPrompt,
    };

    const context = {
      workDir: this.projectRoot,
      branch: 'main',
      projectRoot: this.projectRoot,
      teamConfig: {},
    };

    const result = await planner.execute(planTask, context);

    // Parse the task list from the planner output
    try {
      const parsed = this._extractJsonArray(result.summary || result.output);
      const tasks = await this.taskManager.addTasks(parsed);
      return tasks;
    } catch (error) {
      console.error('Failed to parse task plan. Creating single task.');
      const task = await this.taskManager.addTask({
        id: 'T1',
        title: userPrompt.slice(0, 80),
        description: userPrompt,
      });
      return [task];
    }
  }

  /**
   * Assign tasks to agents using round-robin.
   * @param {import('../types/index.js').Task[]} tasks
   */
  async assignTasks(tasks) {
    const agentNames = Array.from(this.adapters.keys());

    for (let i = 0; i < tasks.length; i++) {
      const agentName = agentNames[i % agentNames.length];
      const task = tasks[i];

      try {
        await this.taskManager.claimTask(task.id, agentName);
        const branchName = `agent/${agentName}/${task.id}`;
        await this.taskManager.updateStatus(task.id, 'in_progress', {
          worktree_branch: branchName,
        });
        console.log(`  ${task.id}: "${task.title}" → ${agentName}`);
      } catch (error) {
        console.error(`  Failed to assign ${task.id}: ${error.message}`);
      }
    }
  }

  /**
   * Execute all tasks in dependency-aware parallel waves.
   */
  async executeTasks() {
    while (true) {
      const allTasks = await this.taskManager.getTasks();

      // 1. Mark tasks with failed dependencies as failed
      await this._handleFailedDependencies(allTasks);

      // 2. Check if all tasks are complete
      if (await this.taskManager.isAllComplete()) {
        break;
      }

      // 3. Get ready tasks (pending and unblocked)
      const readyTasks = this._getReadyTasks(allTasks);
      
      // 4. Handle tasks that are already in_progress (from initial assignTasks)
      const inProgress = allTasks.filter((t) => t.status === 'in_progress');
      
      const tasksToRun = [...inProgress];
      
      // Assign and add ready tasks
      if (readyTasks.length > 0) {
        await this.assignTasks(readyTasks);
        // Refresh after assignment
        const refreshed = await this.taskManager.getTasks();
        const newlyInProgress = refreshed.filter((t) => 
          readyTasks.some(r => r.id === t.id) && t.status === 'in_progress'
        );
        tasksToRun.push(...newlyInProgress);
      }

      if (tasksToRun.length > 0) {
        // Log current wave
        const ids = tasksToRun.map(t => t.id).join(', ');
        console.log(`  Wave: starting tasks [${ids}]`);
        
        // Execute this wave in parallel
        const wave = tasksToRun.map((task) => this._runTask(task));
        await Promise.all(wave);
      } else {
        // Nothing ready, wait for polling
        const summary = await this.taskManager.getSummary();
        console.log(
          `  Progress: ${summary.done} done, ${summary.pending} blocked, ${summary.failed} failed`,
        );
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
    }
  }

  /**
   * Return tasks that are ready to execute (all depends_on are done).
   * @param {import('../types/index.js').Task[]} tasks
   * @returns {import('../types/index.js').Task[]}
   */
  _getReadyTasks(tasks) {
    return tasks.filter((task) => {
      if (task.status !== 'pending') return false;
      if (task.depends_on.length === 0) return true;
      return task.depends_on.every((depId) => {
        const dep = tasks.find((t) => t.id === depId);
        return dep && dep.status === 'done';
      });
    });
  }

  /**
   * Mark pending tasks as failed if their dependencies failed.
   * @param {import('../types/index.js').Task[]} tasks
   */
  async _handleFailedDependencies(tasks) {
    for (const task of tasks.filter((t) => t.status === 'pending')) {
      const failedDep = task.depends_on.find((depId) => {
        const dep = tasks.find((t) => t.id === depId);
        return dep && dep.status === 'failed';
      });

      if (failedDep) {
        await this.taskManager.updateStatus(task.id, 'failed', {
          summary: `Skipped: dependency ${failedDep} failed`,
        });
      }
    }
  }

  /**
   * Execute a single task using its assigned adapter.
   * @param {import('../types/index.js').Task} task
   */
  async _runTask(task) {
    const adapter = this.adapters.get(task.assigned_to);
    if (!adapter) {
      console.error(`  No adapter for ${task.assigned_to}`);
      return;
    }

    try {
      // Create worktree
      const worktreePath = join(this.worktreesDir, `${task.assigned_to}-${task.id}`);
      await this._createWorktree(worktreePath, task.worktree_branch);

      const context = {
        workDir: worktreePath,
        branch: task.worktree_branch,
        projectRoot: this.projectRoot,
        teamConfig: { adapters: Array.from(this.adapters.keys()) },
      };

      console.log(`  Executing ${task.id} with ${task.assigned_to}...`);
      const result = await adapter.execute(task, context);

      // Save result
      const resultPath = join(this.merger.resultsDir, `${task.id}.json`);
      await writeFile(resultPath, JSON.stringify({
        task_id: task.id,
        agent: task.assigned_to,
        ...result,
      }, null, 2));

      // Update task status
      await this.taskManager.updateStatus(task.id, result.status, {
        result_ref: resultPath,
      });

      console.log(`  ${task.id} ${result.status}: ${result.summary.slice(0, 100)}`);
    } catch (error) {
      console.error(`  ${task.id} error: ${error.message}`);
      try {
        await this.taskManager.updateStatus(task.id, 'failed');
      } catch { /* ignore */ }
    }
  }

  /**
   * Poll task status until all tasks are complete.
   */
  async monitorUntilComplete() {
    while (this._running) {
      const complete = await this.taskManager.isAllComplete();
      if (complete) break;

      const summary = await this.taskManager.getSummary();
      console.log(
        `  Progress: ${summary.done} done, ${summary.in_progress} running, ` +
        `${summary.pending} pending, ${summary.failed} failed`,
      );

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  /**
   * Clean up worktrees after completion.
   * @param {import('../types/index.js').Task[]} tasks
   */
  async cleanup(tasks) {
    for (const task of tasks) {
      if (task.worktree_branch) {
        const worktreePath = join(
          this.worktreesDir,
          `${task.assigned_to}-${task.id}`,
        );
        await this.merger.cleanupWorktree(worktreePath, task.worktree_branch);
      }
    }
    console.log('Cleanup complete.');
  }

  // -- Private helpers --

  /**
   * Create a git worktree for an agent's task.
   * @param {string} worktreePath
   * @param {string} branchName
   */
  async _createWorktree(worktreePath, branchName) {
    if (existsSync(worktreePath)) return;

    await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branchName], {
      cwd: this.projectRoot,
    });
  }

  /**
   * Extract a JSON array from text that might contain surrounding prose.
   * @param {string} text
   * @returns {Object[]}
   */
  _extractJsonArray(text) {
    // Try direct parse first
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }

    // Find JSON array in text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }

    throw new Error('No JSON array found in output');
  }
}

// -- CLI Entry Point --

const args = process.argv.slice(2);

/**
 * Main CLI handler
 */
async function main() {
  const orchestrator = new Orchestrator(process.cwd());

  if (args.includes('--tasks')) {
    const fileIdx = args.indexOf('--tasks') + 1;
    const filePath = args[fileIdx];
    if (!filePath) {
      console.error('Error: --tasks requires a file path');
      process.exit(1);
    }

    await orchestrator.initialize();
    const tasks = await orchestrator.loadTasksFromFile(filePath);
    await orchestrator.run(tasks);
  } else if (args.length > 0 && !args[0].startsWith('-')) {
    const prompt = args.join(' ');
    await orchestrator.initialize();
    await orchestrator.run(prompt);
  } else if (args.includes('--help') || args.length === 0) {
    console.log(`
Multi-Agent Orchestrator — POC v1

Usage:
  node src/orchestrator/index.js "Your task description here"
  node src/orchestrator/index.js --tasks tasks.json
  node src/orchestrator/index.js --check-agents

Options:
  --tasks <file>    Load tasks from a JSON file instead of decomposing a prompt
  --check-agents    Check which AI CLI agents are available
  --help            Show this help message

Examples:
  node src/orchestrator/index.js "Build a REST API with user auth and unit tests"
  node src/orchestrator/index.js --tasks my-tasks.json
  node src/orchestrator/index.js --check-agents
    `);
  } else if (args.includes('--check-agents')) {
    await import('../adapters/check.js');
  }
}

main().catch((error) => {
  console.error(`\nOrchestration failed: ${error.message}`);
  process.exit(1);
});
