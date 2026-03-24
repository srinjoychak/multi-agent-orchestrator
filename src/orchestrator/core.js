/**
 * Orchestrator core — library entry point.
 *
 * This module exports the Orchestrator class only. No process.argv, no main().
 * The CLI entry point lives in index.js.
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

const execFileAsync = promisify(execFile);

/**
 * Main orchestrator class.
 *
 * Lifecycle (chat-driven):
 *   new Orchestrator(root) → initialize() → decomposeTasks() → assignTasks()
 *   → _runTask() per task → merger.mergeAll()
 *
 * Or autonomously via run().
 */
export class Orchestrator {
  /**
   * @param {string} projectRoot
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=2000]
   * @param {number} [options.taskTimeoutMs=300000]
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = resolve(projectRoot);
    this.agentTeamDir = join(this.projectRoot, '.agent-team');
    this.worktreesDir = join(this.projectRoot, '.worktrees');
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 900_000; // 15 min — complex tasks need time

    this.taskManager = new TaskManager(this.agentTeamDir);
    this.comms = new FileCommChannel(this.agentTeamDir);
    this.merger = new ResultMerger(this.projectRoot, this.agentTeamDir);

    this.adapters = new Map();
    this._running = false;
  }

  /**
   * Initialize: create dirs, probe CLIs, apply agents.json config.
   * @param {Object} [options]
   * @param {boolean} [options.quiet=false] - suppress banner output
   */
  async initialize(options = {}) {
    if (!options.quiet) {
      console.log('');
      console.log('╔══════════════════════════════════════╗');
      console.log('║   Multi-Agent Orchestrator  v0.2.0   ║');
      console.log('╚══════════════════════════════════════╝');
      console.log('');
      console.log('Initializing orchestrator...');
    }

    for (const dir of [this.agentTeamDir, this.worktreesDir, this.merger.resultsDir]) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    await this.taskManager.initialize();
    await this.comms.initialize();

    // Load agents.json capability overrides if present
    const agentsConfig = await this._loadAgentsConfig();

    // Detect and register available adapters
    const candidates = [
      new ClaudeCodeAdapter({ timeoutMs: this.taskTimeoutMs, agentConfig: agentsConfig['claude-code'] }),
      new GeminiAdapter({ timeoutMs: this.taskTimeoutMs, agentConfig: agentsConfig['gemini'] }),
    ];

    for (const adapter of candidates) {
      const available = await adapter.isAvailable();
      if (available) {
        this.adapters.set(adapter.name, adapter);
        if (!options.quiet) console.log(`  [+] ${adapter.name} — available`);
      } else {
        if (!options.quiet) console.log(`  [-] ${adapter.name} — not found, skipping`);
      }
    }

    if (this.adapters.size === 0) {
      throw new Error('No AI agents available. Install claude or gemini CLI.');
    }

    if (!options.quiet) console.log(`  ${this.adapters.size} agent(s) ready.\n`);
  }

  /**
   * Load agents.json from project root (optional config).
   * @returns {Promise<Object>}
   */
  async _loadAgentsConfig() {
    const configPath = join(this.projectRoot, 'agents.json');
    if (!existsSync(configPath)) return {};
    try {
      const raw = await readFile(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * Run the full autonomous pipeline (v1 compat).
   * @param {string|import('../types/index.js').Task[]} input
   */
  async run(input) {
    this._running = true;

    try {
      let tasks;
      if (typeof input === 'string') {
        console.log('Step 1: Decomposing request into tasks...');
        tasks = await this.decomposeTasks(input);
      } else {
        tasks = input;
        console.log(`Step 1: Skipped (loaded ${tasks.length} tasks from file).`);
      }
      console.log(`  Working with ${tasks.length} tasks.\n`);

      console.log('Step 2: Assigning tasks to agents...');
      await this.assignTasks(tasks);

      console.log('\nStep 3: Executing tasks in parallel...');
      await this.executeTasks();

      console.log('\nStep 4: Monitoring progress...');
      await this.monitorUntilComplete();

      console.log('\nStep 5: Merging results...');
      const allTasks = await this.taskManager.getTasks();
      const mergeResult = await this.merger.mergeAll(allTasks);

      console.log('\nStep 6: Generating report...');
      const report = await this.merger.generateReport(allTasks, mergeResult);
      console.log('\n' + report);

      await this.cleanup(allTasks);
    } finally {
      this._running = false;
      await this.comms.destroy();
    }
  }

  /**
   * Decompose a user prompt into discrete tasks using the first available agent.
   * @param {string} userPrompt
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async decomposeTasks(userPrompt) {
    const planner = this.adapters.values().next().value;

    const planPrompt = [
      'You are a senior engineering team lead. Decompose the following request into',
      'a list of discrete, parallelizable tasks for a team of AI coding agents.',
      '',
      'RULES:',
      '1. Return ONLY a valid JSON array — no prose, no markdown, no explanation.',
      '2. Each task must be completable by one agent working alone in its own directory.',
      '3. Tasks must NOT touch the same files — zero overlap in scope.',
      '4. Express dependencies via "depends_on": ["T1"] — only block when truly necessary.',
      '5. Each task must have a "type" field — choose ONE from:',
      '   code, refactor, test, review, debug, research, docs, analysis',
      '6. Keep tasks granular — max one concern per task.',
      '',
      'OUTPUT SCHEMA (strict):',
      '[',
      '  {',
      '    "id": "T1",',
      '    "title": "Short imperative title (max 60 chars)",',
      '    "description": "Detailed description of exactly what to do and where",',
      '    "type": "code",',
      '    "depends_on": []',
      '  }',
      ']',
      '',
      'EXAMPLE for "add user auth to the API":',
      '[',
      '  {"id":"T1","title":"Add JWT auth middleware","description":"Create src/middleware/auth.js with JWT verify logic using jsonwebtoken","type":"code","depends_on":[]},',
      '  {"id":"T2","title":"Protect API routes","description":"Update src/routes/*.js to apply auth middleware to all protected endpoints","type":"refactor","depends_on":["T1"]},',
      '  {"id":"T3","title":"Write auth middleware tests","description":"Create tests/auth.test.js covering valid token, expired token, missing token cases","type":"test","depends_on":["T1"]}',
      ']',
      '',
      `REQUEST: ${userPrompt}`,
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

    try {
      const VALID_TYPES = new Set(['code', 'refactor', 'test', 'review', 'debug', 'research', 'docs', 'analysis']);
      const parsed = this._extractJsonArray(result.summary || result.output);
      const normalised = parsed.map((t) => ({
        ...t,
        type: VALID_TYPES.has(t.type) ? t.type : 'code',
      }));
      return this.taskManager.addTasks(normalised);
    } catch {
      console.error('Failed to parse task plan. Creating single task.');
      const task = await this.taskManager.addTask({
        id: 'T1',
        title: userPrompt.slice(0, 80),
        description: userPrompt,
        type: 'docs', // Add default type
      });
      return [task];
    }
  }

  /**
   * Assign tasks to agents via capability matching with quota-weighted selection.
   *
   * Each agent may declare a `quota` in agents.json (e.g. 30 for 30%). Tasks are
   * distributed proportionally: the agent with the lowest `assignedCount / quota`
   * ratio is preferred among eligible candidates. Agents without a quota configured
   * are treated as having equal weight (quota = 1).
   *
   * Priority order per task:
   *   1. Capable agents not previously tried — selected by quota ratio
   *   2. Any agent not previously tried — selected by quota ratio
   *   3. Force-assign by quota ratio (avoids getting stuck when all tried)
   *
   * @param {import('../types/index.js').Task[]} tasks
   */
  async assignTasks(tasks) {
    const agentNames = Array.from(this.adapters.keys());

    // quota weight per agent (from agents.json config, default 1 for equal weight)
    const quotas = new Map(
      agentNames.map((name) => [name, this.adapters.get(name).agentConfig?.quota ?? 1]),
    );

    // running count of tasks assigned to each agent in this batch
    const assignedCounts = new Map(agentNames.map((name) => [name, 0]));

    /**
     * Among the given candidates, return the one with the lowest
     * assignedCount / quota ratio (most "under quota").
     * @param {string[]} candidates
     * @returns {string}
     */
    const pickByQuota = (candidates) => {
      let best = candidates[0];
      let bestRatio = assignedCounts.get(best) / quotas.get(best);
      for (let i = 1; i < candidates.length; i++) {
        const name = candidates[i];
        const ratio = assignedCounts.get(name) / quotas.get(name);
        if (ratio < bestRatio) {
          bestRatio = ratio;
          best = name;
        }
      }
      return best;
    };

    for (const task of tasks) {
      const previousAgents = task.previous_agents || [];
      let agentName = null;
      let routingNote = '';

      // 1. Prefer a capable agent not previously tried — quota-weighted
      if (task.type) {
        const capableFresh = agentNames.filter(
          (name) => this.adapters.get(name).capabilities.includes(task.type) && !previousAgents.includes(name),
        );
        if (capableFresh.length > 0) {
          agentName = pickByQuota(capableFresh);
          routingNote = `[${task.type}]`;
        }
      }

      // 2. All capable agents exhausted — try any agent not previously tried, quota-weighted
      if (!agentName) {
        const freshAgents = agentNames.filter((name) => !previousAgents.includes(name));
        if (freshAgents.length > 0) {
          agentName = pickByQuota(freshAgents);
          routingNote = task.type
            ? `[${task.type}→fallback, all capable agents tried]`
            : '[quota]';
        }
      }

      // 3. All agents tried — force by quota ratio (task may fail again, but don't get stuck)
      if (!agentName) {
        agentName = pickByQuota(agentNames);
        routingNote = `[${task.type || 'any'}→force, all agents previously tried]`;
      }

      const isReassignment = previousAgents.length > 0;

      try {
        await this.taskManager.claimTask(task.id, agentName);
        const branchName = `agent/${agentName}/${task.id}`;
        await this.taskManager.updateStatus(task.id, 'in_progress', {
          worktree_branch: branchName,
        });

        assignedCounts.set(agentName, assignedCounts.get(agentName) + 1);

        if (isReassignment) {
          console.log(
            `  ${task.id}: reassigned ${previousAgents.at(-1)} → ${agentName} ` +
            `(after ${task.retries} failure(s)) ${routingNote}`,
          );
        } else {
          console.log(`  ${task.id}: "${task.title}" → ${agentName} ${routingNote}`);
        }
      } catch (error) {
        console.error(`  Failed to assign ${task.id}: ${error.message}`);
      }
    }
  }

  /**
   * Execute all tasks in dependency-aware parallel waves.
   */
  async executeTasks() {
    const dispatched = new Set();

    while (true) {
      const allTasks = await this.taskManager.getTasks();
      await this._handleFailedDependencies(allTasks);

      if (await this.taskManager.isAllComplete()) break;

      const readyTasks = this._getReadyTasks(allTasks);
      const inProgress = allTasks.filter(
        (t) => t.status === 'in_progress' && !dispatched.has(t.id),
      );
      const tasksToRun = [...inProgress];

      if (readyTasks.length > 0) {
        await this.assignTasks(readyTasks);
        const refreshed = await this.taskManager.getTasks();
        const newlyInProgress = refreshed.filter(
          (t) => readyTasks.some((r) => r.id === t.id) && t.status === 'in_progress' && !dispatched.has(t.id),
        );
        tasksToRun.push(...newlyInProgress);
      }

      if (tasksToRun.length > 0) {
        const ids = tasksToRun.map((t) => t.id).join(', ');
        console.log(`  Wave: starting tasks [${ids}]`);
        tasksToRun.forEach((t) => dispatched.add(t.id));
        await Promise.all(tasksToRun.map((task) => this._runTask(task)));
        tasksToRun.forEach((t) => dispatched.delete(t.id));
      } else {
        const summary = await this.taskManager.getSummary();
        console.log(
          `  Progress: ${summary.done} done, ${summary.pending} blocked, ${summary.failed} failed`,
        );
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
    }
  }

  /**
   * Execute a single task by ID. Used by the `execute` verb in chat-driven mode.
   * @param {string} taskId
   * @returns {Promise<import('../types/index.js').TaskResult>}
   */
  async executeTask(taskId) {
    const allTasks = await this.taskManager.getTasks();
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return this._runTask(task);
  }

  /**
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

  /** @param {import('../types/index.js').Task[]} tasks */
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
   * Execute a single task with its assigned adapter.
   * @param {import('../types/index.js').Task} task
   */
  async _runTask(task) {
    const adapter = this.adapters.get(task.assigned_to);
    if (!adapter) {
      console.error(`  No adapter for ${task.assigned_to}`);
      return;
    }

    try {
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

      const resultPath = join(this.merger.resultsDir, `${task.id}.json`);
      await writeFile(resultPath, JSON.stringify({
        task_id: task.id,
        agent: task.assigned_to,
        ...result,
      }, null, 2));

      await this.taskManager.updateStatus(task.id, result.status, {
        result_ref: resultPath,
      });

      console.log(`  ${task.id} ${result.status}: ${result.summary.slice(0, 100)}`);
      return result;
    } catch (error) {
      console.error(`  ${task.id} error: ${error.message}`);
      try {
        await this.taskManager.updateStatus(task.id, 'failed');
      } catch { /* ignore */ }
    }
  }

  /** Poll until all tasks are complete. */
  async monitorUntilComplete() {
    while (this._running) {
      await this.taskManager.resetStaleClaims();
      if (await this.taskManager.isAllComplete()) break;

      const summary = await this.taskManager.getSummary();
      console.log(
        `  Progress: ${summary.done} done, ${summary.in_progress} running, ` +
        `${summary.pending} pending, ${summary.failed} failed`,
      );
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  /** @param {import('../types/index.js').Task[]} tasks */
  async cleanup(tasks) {
    for (const task of tasks) {
      if (task.worktree_branch) {
        const worktreePath = join(this.worktreesDir, `${task.assigned_to}-${task.id}`);
        await this.merger.cleanupWorktree(worktreePath, task.worktree_branch);
      }
    }
    console.log('Cleanup complete.');
  }

  /**
   * Load tasks from a JSON file.
   * @param {string} filePath
   * @returns {Promise<import('../types/index.js').Task[]>}
   */
  async loadTasksFromFile(filePath) {
    const absolutePath = resolve(filePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Tasks file not found: ${absolutePath}`);
    }
    try {
      const content = await readFile(absolutePath, 'utf-8');
      const parsed = JSON.parse(content);
      const taskList = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
      if (taskList.length === 0) throw new Error('Tasks file contains no tasks.');
      return this.taskManager.addTasks(taskList);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in tasks file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * @param {string} worktreePath
   * @param {string} branchName
   */
  async _createWorktree(worktreePath, branchName) {
    if (existsSync(worktreePath)) return;
    await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branchName], {
      cwd: this.projectRoot,
    });
  }

  /** @param {string} text */
  _extractJsonArray(text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }

    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);

    throw new Error('No JSON array found in output');
  }
}
