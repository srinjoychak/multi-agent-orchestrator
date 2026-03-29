/**
 * Orchestrator Core — v3
 *
 * Coordinates task decomposition, agent assignment, Docker execution,
 * and result management. Consumes:
 *   - TaskManager (SQLite)
 *   - DockerRunner (container lifecycle)
 *   - WorktreeManager (git isolation)
 *   - AgentRouter (capability + quota routing)
 *
 * Token optimization:
 *   - Gemini handles research/docs/analysis by default (free tier)
 *   - Claude handles code/refactor/debug (precision tasks)
 *   - Token usage is tracked per task in SQLite
 */

import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { TaskManager, MAX_DELEGATE_DEPTH } from '../taskmanager/index.js';
import { DockerRunner } from '../docker/runner.js';
import { WorktreeManager } from '../worktree/index.js';
import { AgentRouter } from '../router/index.js';
import { Logger } from '../logger/index.js';

const log = new Logger('orchestrator');

const execFileAsync = promisify(execFile);

const VALID_TYPES = new Set(['code', 'refactor', 'test', 'review', 'debug', 'research', 'docs', 'analysis']);

/**
 * Agent definitions — maps agentName to CLI config.
 * Merged with agents.json on initialize().
 */
const DEFAULT_AGENTS = {
  gemini: {
    image: 'worker-gemini:latest',
    capabilities: ['research', 'docs', 'analysis', 'code', 'test'],
    quota: 70,
    timeoutMs: 300_000,
    cliArgs: (prompt) => ['-p', prompt, '--approval-mode', 'yolo', '--output-format', 'json'],
    parseOutput: parseGeminiOutput,
    auth: { mountFrom: `${process.env.HOME}/.gemini`, mountTo: '/home/node/.gemini', mode: 'rw' },
  },
  'claude-code': {
    image: 'worker-claude:latest',
    capabilities: ['code', 'refactor', 'test', 'debug', 'review'],
    quota: 30,
    timeoutMs: 300_000,
    cliArgs: (prompt) => ['--print', '-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions', '--no-session-persistence'],
    parseOutput: parseClaudeOutput,
    auth: { mountFrom: `${process.env.HOME}/.claude`, mountTo: '/home/node/.claude', mode: 'ro' },
  },
  codex: {
    image: 'worker-codex:latest',
    capabilities: ['research', 'docs', 'analysis', 'code', 'test', 'refactor', 'debug', 'review'],
    quota: 20,
    timeoutMs: 300_000,
    cliArgs: (prompt) => [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--cd',
      '/work',
      prompt,
    ],
    parseOutput: parseCodexOutput,
    auth: { mountFrom: `${process.env.HOME}/.codex`, mountTo: '/home/node/.codex', mode: 'rw' },
  },
};

export class Orchestrator {
  /**
   * @param {string} projectRoot
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=2000]
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = resolve(projectRoot);
    // Use ~/.local/share (ext4, survives WSL2 reboots) instead of /tmp (wiped on reboot)
    // and instead of /mnt/d (9p/DrvFs — SQLite WAL locking is broken there).
    const defaultStateDir = join(homedir(), '.local', 'share', 'multi-agent-orchestrator-v3');
    this.stateDir = options.stateDir ?? defaultStateDir;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;

    this.taskManager = new TaskManager(this.stateDir);
    this.docker = new DockerRunner({ stateDir: this.stateDir });
    this.worktreeManager = new WorktreeManager(this.projectRoot);

    /** @type {Map<string, Object>} agentName -> agent config */
    this.agents = new Map();
    this.router = null;

    /** @type {Map<string, number>} agentName -> current running container count */
    this._runningCounts = new Map();
  }

  /**
   * Initialize: load agent config, verify Docker, set up directories.
   * @param {Object} [options]
   * @param {boolean} [options.quiet=false]
   */
  async initialize(options = {}) {
    if (!options.quiet) {
      log.info('');
      log.info('Multi-Agent Orchestrator v3');
      log.info('');
    }

    // Create state directories
    for (const dir of [this.stateDir, join(this.stateDir, 'results')]) {
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    }

    await this.taskManager.initialize();

    // Load agents.json config and merge with defaults
    const agentsJson = await this._loadAgentsJson();
    for (const [name, defaults] of Object.entries(DEFAULT_AGENTS)) {
      const override = agentsJson[name] ?? {};
      const merged = { ...defaults, ...override, name };
      if (override.timeout_seconds && !override.timeoutMs) {
        merged.timeoutMs = override.timeout_seconds * 1000;
      }
      this.agents.set(name, merged);
    }

    // Build adapter-like objects for the router
    const adapterMap = new Map(
      Array.from(this.agents.entries()).map(([name, cfg]) => [name, { capabilities: cfg.capabilities }])
    );
    this.router = new AgentRouter(adapterMap, Object.fromEntries(this.agents));

    if (!options.quiet) {
      log.info(`  Agents: ${Array.from(this.agents.keys()).join(', ')}`);
      log.info(`  State: ${this.stateDir}`);
      log.info('');
    }
  }

  /**
   * Full pipeline: generate job UUID, decompose, assign, and execute tasks.
   * @param {string} userPrompt
   * @param {Object} [options] — forwarded to executeTasks
   * @returns {Promise<{jobId: string, tasks: Object[]}>}
   */
  async orchestrate(userPrompt, options = {}) {
    const jobId = randomUUID();
    this.taskManager.addJob(jobId, userPrompt);
    log.info(`[orchestrator] Job ${jobId} started`);

    // Hot-reload agents.json (Gap 7)
    const agentsJson = await this._loadAgentsJson();
    for (const [name, defaults] of Object.entries(DEFAULT_AGENTS)) {
      const override = agentsJson[name] ?? {};
      const merged = { ...defaults, ...override, name };
      if (override.timeout_seconds && !override.timeoutMs) {
        merged.timeoutMs = override.timeout_seconds * 1000;
      }
      this.agents.set(name, merged);
    }
    // Rebuild router with updated config
    const adapterMap = new Map(
      Array.from(this.agents.entries()).map(([name, cfg]) => [name, { capabilities: cfg.capabilities }])
    );
    this.router = new AgentRouter(adapterMap, Object.fromEntries(this.agents));

    const tasks = await this.decomposeTasks(userPrompt, jobId);
    await this.executeTasks({ ...options, jobId });

    const finalTasks = await this.taskManager.getJobTasks(jobId);
    const allDone = finalTasks.every(t => t.status === 'done');
    this.taskManager.finishJob(jobId, allDone ? 'done' : 'failed');

    log.info(`[orchestrator] Job ${jobId} finished — ${allDone ? 'done' : 'failed'}`);
    return { jobId, tasks: finalTasks };
  }

  /**
   * Decompose a user prompt into discrete tasks using a planner.
   * Uses Gemini for decomposition (free tier) to save Claude quota.
   * @param {string} userPrompt
   * @param {string} [jobId] — if provided, tasks are tagged with this job
   * @returns {Promise<Object[]>}
   */
  async decomposeTasks(userPrompt, jobId) {
    // Short-circuit: very short prompts are single tasks
    if (userPrompt.length < 200 && !userPrompt.includes('\n')) {
      return this.taskManager.addTasks([{
        id: 'T1',
        job_id: jobId ?? null,
        title: userPrompt.slice(0, 80),
        description: userPrompt,
        type: 'code',
      }]);
    }

    // Gather project context (Gap 3)
    let projectContext = '';
    try {
      const pkgPath = join(this.projectRoot, 'package.json');
      const pkgRaw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw);
      const { stdout: srcFiles } = await execFileAsync('find', ['src', '-name', '*.js', '-not', '-path', '*/node_modules/*'], { cwd: this.projectRoot });
      projectContext = [
        '',
        'Project context (do not change these):',
        `- Module system: ${pkg.type === 'module' ? 'ESM (import/export, .js extensions required)' : 'CommonJS (require)'}`,
        `- Runtime: Node.js ${process.version}`,
        `- Existing source files:\n${srcFiles.trim().split('\n').map(f => '  ' + f).join('\n')}`,
        `- Test framework: node:test (built-in, no jest/mocha)`,
        `- Dependencies: ${Object.keys(pkg.dependencies ?? {}).join(', ')}`,
      ].join('\n');
    } catch { /* non-fatal */ }

    const planPrompt = [
      'Decompose the following software engineering request into discrete, parallelizable tasks.',
      '',
      'Rules:',
      '1. Return ONLY a valid JSON array — no prose, no markdown.',
      '2. Each task must be completable by one agent working alone in its own directory.',
      '3. Tasks must NOT touch the same files.',
      '4. Express dependencies via "depends_on": ["T1"].',
      '5. type must be one of: code, refactor, test, review, debug, research, docs, analysis',
      '6. In each task description, list the exact files the task will create or modify.',
      '7. No two tasks may list the same file — tasks that share files must use depends_on.',
      '',
      projectContext,
      '',
      'Schema: [{"id":"T1","title":"<60 chars","description":"detailed instructions","type":"code","depends_on":[]}]',
      '',
      `Request: ${userPrompt}`,
    ].join('\n');

    // Run planner in a temp directory (avoids CLAUDE.md/GEMINI.md overwrite)
    const planDir = await mkdtemp(join(tmpdir(), 'orch-plan-'));
    let planOutput = '';

    try {
      planOutput = await this._runPlanner(planPrompt, planDir);
    } finally {
      await rm(planDir, { recursive: true, force: true });
    }

    try {
      const parsed = this._extractJsonArray(planOutput);
      return this.taskManager.addTasks(
        parsed.map(t => ({ ...t, job_id: jobId ?? null, type: VALID_TYPES.has(t.type) ? t.type : 'code' }))
      );
    } catch {
      log.error('[orchestrator] Decompose failed, creating single task');
      return this.taskManager.addTasks([{
        id: 'T1',
        job_id: jobId ?? null,
        title: userPrompt.slice(0, 80),
        description: userPrompt,
        type: 'code',
      }]);
    }
  }

  /**
   * Assign pending tasks to agents via capability + quota routing.
   * @param {Object[]} tasks
   * @returns {Promise<Object[]>} assigned tasks
   */
  async assignTasks(tasks) {
    const pending = tasks.filter(t => t.status === 'pending');
    if (pending.length === 0) return [];

    this.router.resetCounts();
    const assignments = this.router.assign(pending);
    const assigned = [];

    for (const { task, agentName } of assignments) {
      try {
        await this.taskManager.claimTask(task.id, agentName);
        const branch = this.worktreeManager.branchName(task.id, agentName);
        await this.taskManager.updateStatus(task.id, 'in_progress', { worktree_branch: branch, assigned_to: agentName });
        assigned.push(task.id);
        log.info(`  [assign] ${task.id} "${task.title}" -> ${agentName}`);
      } catch (err) {
        log.error(`  [assign] Failed to assign ${task.id}: ${err.message}`);
      }
    }
    return assigned;
  }

  /**
   * Execute all tasks in dependency-aware parallel waves.
   * Circuit breaker: exits after maxIterations or totalTimeoutMs to prevent
   * infinite loops when tasks keep cycling between pending/failed.
   * @param {Object} [options]
   * @param {string} [options.jobId] — if provided, only executes tasks for this job
   * @param {number} [options.maxIterations=50]
   * @param {number} [options.totalTimeoutMs=600000] — 10 minutes default
   */
  async executeTasks(options = {}) {
    const { jobId } = options;
    const maxIterations = options.maxIterations ?? 50;
    const totalTimeoutMs = options.totalTimeoutMs ?? 600_000;
    const dispatched = new Set();
    const startTime = Date.now();
    let iteration = 0;
    let lastStateHash = '';
    let stuckCount = 0;

    const getTasks = () => jobId
      ? this.taskManager.getJobTasks(jobId)
      : this.taskManager.getTasks();

    while (true) {
      iteration++;
      const elapsed = Date.now() - startTime;

      // Move retry-queue tasks back to pending if their backoff expires (Gap 8)
      this.taskManager.retryDue();

      // Circuit breaker: max iterations
      if (iteration > maxIterations) {
        log.error(`[orchestrator] Circuit breaker: exceeded ${maxIterations} iterations. Stopping.`);
        break;
      }

      // Circuit breaker: total timeout
      if (elapsed > totalTimeoutMs) {
        log.error(`[orchestrator] Circuit breaker: exceeded ${Math.round(totalTimeoutMs / 1000)}s total timeout. Stopping.`);
        break;
      }

      const allTasks = await getTasks();

      // Circuit breaker: stuck detection — if task states haven't changed in 3 consecutive iterations
      const stateHash = allTasks.map(t => `${t.id}:${t.status}:${t.retries}`).join('|');
      if (stateHash === lastStateHash) {
        stuckCount++;
        const active = allTasks.filter(t => t.status !== 'done' && t.status !== 'failed');
        if (active.length === 0 || stuckCount >= 3) {
          log.error(`[orchestrator] Circuit breaker: task states unchanged for ${stuckCount} consecutive iterations. Stopping.`);
          break;
        }
      } else {
        stuckCount = 0;
      }
      lastStateHash = stateHash;

      // Fail tasks whose dependencies failed
      for (const task of allTasks.filter(t => t.status === 'pending')) {
        const failedDep = task.depends_on.find(depId => {
          const dep = allTasks.find(t => t.id === depId);
          return dep?.status === 'failed';
        });
        if (failedDep) {
          this.taskManager.db.prepare("UPDATE tasks SET status='failed', retries=max_retries WHERE id=? AND status='pending'").run(task.id);
        }
      }

      if (await this.taskManager.isAllComplete(jobId)) break;

      const readyTasks = allTasks.filter(t => {
        if (t.status !== 'pending' || t.queue === 'retry') return false;
        return t.depends_on.every(depId => allTasks.find(x => x.id === depId)?.status === 'done');
      });

      const inProgress = allTasks.filter(t => t.status === 'in_progress' && !dispatched.has(t.id));
      const toRun = [...inProgress];

      if (readyTasks.length > 0) {
        await this.assignTasks(readyTasks);
        const refreshed = await getTasks();
        const newlyReady = refreshed.filter(t =>
          readyTasks.some(r => r.id === t.id) && t.status === 'in_progress' && !dispatched.has(t.id)
        );
        toRun.push(...newlyReady);
      }

      // Filter out tasks that would exceed agent concurrency limits
      const concurrencyFiltered = toRun.filter(t => {
        const agentName = t.assigned_to;
        if (!agentName) return true;
        const agentCfg = this.agents.get(agentName);
        const limit = agentCfg?.concurrency ?? Infinity;
        const current = this._runningCounts.get(agentName) ?? 0;
        return current < limit;
      });

      if (concurrencyFiltered.length > 0) {
        log.info(`  [wave ${iteration}] starting ${concurrencyFiltered.map(t => t.id).join(', ')}`);
        concurrencyFiltered.forEach(t => {
          dispatched.add(t.id);
          const agentName = t.assigned_to;
          if (agentName) {
            this._runningCounts.set(agentName, (this._runningCounts.get(agentName) ?? 0) + 1);
          }
        });
        await Promise.all(concurrencyFiltered.map(async t => {
          try {
            await this._runTask(t);
          } finally {
            dispatched.delete(t.id);
            const agentName = t.assigned_to;
            if (agentName) {
              this._runningCounts.set(agentName, Math.max(0, (this._runningCounts.get(agentName) ?? 1) - 1));
            }
          }
        }));
      } else {
        const s = await this.taskManager.getSummary(jobId);
        log.info(`  [iter ${iteration}/${maxIterations}] done=${s.done} running=${s.in_progress} pending=${s.pending} failed=${s.failed} elapsed=${Math.round(elapsed / 1000)}s`);
        await new Promise(r => setTimeout(r, this.pollIntervalMs));
      }
    }

    // End-of-job sweep: prune worktrees for all failed tasks
    const finalTasks = jobId
      ? await this.taskManager.getJobTasks(jobId)
      : await this.taskManager.getTasks();
    for (const t of finalTasks.filter(t => t.status === 'failed' && t.assigned_to)) {
      await this.worktreeManager.prune(t.id, t.assigned_to).catch(() => {});
    }
  }

  /**
   * Execute a single task by ID.
   * @param {string} taskId
   */
  async executeTask(taskId) {
    const task = await this.taskManager.getTask(taskId);
    return this._runTask(task);
  }

  /**
   * Merge a completed task's worktree branch into main.
   * @param {string} taskId
   * @returns {Promise<Object>}
   */
  async acceptTask(taskId) {
    const task = await this.taskManager.getTask(taskId);
    const result = await this.worktreeManager.merge(taskId, task.assigned_to);
    if (result.success) {
      await this.worktreeManager.prune(taskId, task.assigned_to);
    }
    return result;
  }

  /**
   * Permanently discard a completed task without re-queuing.
   * @param {string} taskId
   * @returns {Promise<Object>}
   */
  async discardTask(taskId) {
    const task = await this.taskManager.getTask(taskId);
    if (task.assigned_to) {
      await this.worktreeManager.prune(taskId, task.assigned_to).catch(() => {});
    }
    // Force to failed with retries exhausted so it cannot be re-queued
    this.taskManager.db.prepare(
      `UPDATE tasks SET status = 'failed', retries = max_retries WHERE id = ?`
    ).run(taskId);
    return { discarded: true };
  }

  /**
   * Re-queue a task with rejection reason.
   * @param {string} taskId
   * @param {string} reason
   */
  async rejectTask(taskId, reason) {
    const task = await this.taskManager.getTask(taskId);
    if (task.assigned_to) {
      await this.worktreeManager.prune(taskId, task.assigned_to).catch(() => {});
    }
    return this.taskManager.rejectTask(taskId, reason);
  }

  /**
   * Get the git diff for a task's worktree.
   * @param {string} taskId
   */
  async getTaskDiff(taskId) {
    const task = await this.taskManager.getTask(taskId);
    return this.worktreeManager.diff(taskId, task.assigned_to ?? 'unknown');
  }

  /**
   * Get live logs for a running worker container.
   * @param {string} taskId
   * @param {number} [tail=100]
   */
  async getTaskLogs(taskId, tail = 100) {
    const task = await this.taskManager.getTask(taskId);
    if (!task.container_id) return { stdout: '', stderr: '' };
    return this.docker.logs(task.container_id, tail);
  }

  /**
   * Force-kill a running worker container.
   * @param {string} taskId
   */
  async killTask(taskId) {
    const task = await this.taskManager.getTask(taskId);
    if (!task.container_id) return { killed: false };
    const killed = await this.docker.kill(task.container_id);
    if (killed) {
      await this.taskManager.updateStatus(taskId, 'failed').catch(() => {});
      this.taskManager.db.prepare('UPDATE tasks SET retries=max_retries WHERE id=?').run(taskId);
      if (task.assigned_to) {
        await this.worktreeManager.prune(taskId, task.assigned_to).catch(() => {});
      }
    }
    return { killed, container_id: task.container_id };
  }

  /**
   * Host-led delegation: create a child task and execute it synchronously.
   *
   * @param {string} subagentName — logical role to delegate to ('gemini', 'claude-code', 'codex')
   * @param {string} prompt — the task description/instructions
   * @param {string} [type='code'] — task type hint ('code'|'research'|'analysis'|...)
   * @param {string|null} [parentTaskId=null] — ID of the parent task spawning this child
   * @param {Object} [opts={}]
   * @param {boolean} [opts.mergeBack=true] — auto merge-back for non-research tasks
   * @returns {Promise<Object>} canonical result envelope
   */
  async delegate(subagentName, prompt, type = 'code', parentTaskId = null, opts = {}) {
    // 1. Validate subagentName
    if (!this.agents.has(subagentName)) {
      throw new Error(`Unknown subagent: ${subagentName}`);
    }

    // 2. Resolve delegate_depth & enforce MAX_DELEGATE_DEPTH
    let delegateDepth = 0;
    let parentTask = null;
    if (parentTaskId) {
      parentTask = await this.taskManager.getTask(parentTaskId);
      delegateDepth = (parentTask.delegate_depth ?? 0) + 1;
    }
    if (delegateDepth > MAX_DELEGATE_DEPTH) {
      throw new Error(`delegate_depth limit exceeded (max ${MAX_DELEGATE_DEPTH})`);
    }

    // 3. Create child task
    let childTask;
    const taskData = {
      id: `D-${randomUUID().slice(0, 8)}`,
      job_id: parentTask?.job_id ?? null,
      title: prompt.slice(0, 80),
      description: prompt,
      type: type ?? 'code',
      subagent_name: subagentName,
      routing_reason: 'host_delegated',
    };

    if (parentTaskId) {
      childTask = await this.taskManager.createDelegatedTask(parentTaskId, taskData);
    } else {
      childTask = await this.taskManager.addTask({
        ...taskData,
        is_delegated: true,
        delegate_depth: 0,
      });
    }

    // 4. Assign to agent (bypass quota routing for explicit delegation)
    await this.taskManager.claimTask(childTask.id, subagentName);
    const branch = this.worktreeManager.branchName(childTask.id, subagentName);
    await this.taskManager.updateStatus(childTask.id, 'in_progress', {
      worktree_branch: branch,
      assigned_to: subagentName,
    });

    // 5. Execute via _runTask() — this is synchronous for the caller
    await this._runTask(childTask);

    // 6. Build result envelope — after _runTask() returns, reload the task from DB:
    const done = await this.taskManager.getTask(childTask.id);
    const resultData = done.result_data ?? {
      summary: done.status === 'done' ? 'Task completed' : 'Task failed',
      provider: subagentName,
      model: null,
      files_changed: [],
      duration_ms: 0,
    };

    // 7. Merge-back
    const isResearch = ['research', 'analysis', 'docs'].includes(type);
    if (!isResearch && opts.mergeBack !== false && done.status === 'done') {
      try {
        await this.acceptTask(childTask.id);
        resultData.merged = true;
      } catch (mergeErr) {
        resultData.merged = false;
        resultData.merge_error = mergeErr.message;
      }
    }

    // 8. Return resultData
    return resultData;
  }

  /**
   * Get the live status of the entire workforce.
   * Combines Docker container data with agent concurrency limits.
   */
  async getWorkforceStatus() {
    const containers = await this.docker.listWorkers();
    const agents = Array.from(this.agents.entries()).map(([name, cfg]) => {
      const running = this._runningCounts.get(name) ?? 0;
      const limit = cfg.concurrency ?? 1;

      // Single SQL count query for active delegations
      const activeDelegationsRow = this.taskManager.db.prepare(
        "SELECT COUNT(*) as cnt FROM tasks WHERE is_delegated=1 AND assigned_to=? AND status IN ('in_progress','claimed')"
      ).get(name);

      return {
        agent: name,
        status: running > 0 ? 'active' : 'idle',
        utilization: `${running}/${limit}`,
        load_percent: Math.round((running / limit) * 100),
        active_delegations: activeDelegationsRow?.cnt ?? 0,
      };
    });

    return {
      heartbeat: new Date().toISOString(),
      agents,
      containers: containers.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        uptime: c.created,
      })),
    };
  }

  /**
   * Hard reset: remove all worktrees, clear task state.
   * NOTE: stateDir itself is never deleted — only its contents are cleared —
   * to avoid inode invalidation for shells whose CWD is inside it.
   */
  async reset() {
    await this.worktreeManager.reset();
    this.taskManager.clear();
    log.info('[orchestrator] Hard reset complete');
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  /**
   * Execute a task in a Docker container.
   * @param {Object} task
   */
  async _runTask(task) {
    const agentName = task.assigned_to;
    const agentCfg = this.agents.get(agentName);
    if (!agentCfg) {
      log.error(`  [error] No agent config for ${agentName}`);
      return;
    }

    let worktreePath = null;
    let stubInfo = null;
    try {
      // Create worktree
      ({ path: worktreePath } = await this.worktreeManager.create(task.id, agentName));

      stubInfo = await this._stubWorkerGuidance(agentName, worktreePath);

      // Build CLI prompt
      const prompt = this._buildPrompt(task, agentName, worktreePath);
      const cliArgs = agentCfg.cliArgs(prompt);

      log.info(`  [exec] ${task.id} via ${agentName} in Docker`);
      const jobPrefix = task.job_id ? `${task.job_id.slice(0, 8)}-` : '';
      const containerName = `worker-${agentName}-${jobPrefix}${task.id}`;
      // Record container_id without status change — assignTasks already set in_progress
      this.taskManager.db.prepare('UPDATE tasks SET container_id = ? WHERE id = ?')
        .run(containerName, task.id);

      // Build extra bind-mounts: stub files injected read-only over git-tracked originals
      const extraMounts = (stubInfo.stubs ?? []).map(s => `${s.hostPath}:${s.containerPath}:ro`);

      // Run in Docker
      let runResult;
      try {
        runResult = await this.docker.run({
          taskId: task.id,
          agentName,
          worktreePath,
          cliArgs,
          options: { timeoutMs: agentCfg.timeoutMs, image: agentCfg.image, auth: agentCfg.auth, extraMounts },
        });
      } finally {
        await this._restoreWorkerGuidance(worktreePath, stubInfo);
      }

      // Parse output
      const parsed = agentCfg.parseOutput(runResult.stdout, runResult.stderr, runResult.duration_ms);

      // Detect changed files via git status in worktree
      const filesChanged = await this._getChangedFiles(worktreePath);
      parsed.filesChanged = filesChanged;

      // Auto-commit any uncommitted changes the agent left behind.
      if (filesChanged.length > 0) {
        await this._autoCommit(worktreePath, task.id);
      }

      // Treat zero file changes as a failure for tasks that must produce output.
      // Prevents silent "done" when an agent ran but wrote nothing.
      const requiresOutput = ['code', 'refactor', 'test', 'docs'].includes(task.type);
      if (filesChanged.length === 0 && requiresOutput && runResult.exitCode === 0) {
        log.error(`  [fail] ${task.id}: agent produced no file changes for a ${task.type} task`);
        await this.taskManager.updateStatus(task.id, 'failed').catch(() => {});
        return;
      }

      const finalStatus = runResult.exitCode === 0 && parsed.status !== 'failed' ? 'done' : 'failed';
      const extraFields = {
        result_data: {
          summary: parsed.summary,
          provider: agentName,
          model: null,
          files_changed: filesChanged,
          duration_ms: runResult.duration_ms,
        },
        ...(parsed.token_usage ? { token_usage: parsed.token_usage } : {})
      };
      await this.taskManager.updateStatus(task.id, finalStatus, extraFields);

      log.info(`  [${finalStatus}] ${task.id} (${runResult.duration_ms}ms, ${filesChanged.length} files changed)`);
      return parsed;

    } catch (err) {
      if (worktreePath && stubInfo) {
        await this._restoreWorkerGuidance(worktreePath, stubInfo);
      }
      log.error(`  [error] ${task.id}: ${err.message}`);
      // updateStatus('failed') handles auto-retry internally if retries < max_retries
      await this.taskManager.updateStatus(task.id, 'failed').catch(() => {});
    }
  }

  /**
   * Write stub guidance files to a tmpdir OUTSIDE the worktree, then tell git to
   * ignore them with `--assume-unchanged` so `git add -A` inside the container
   * never stages them. The stubs are injected via Docker bind-mount over the
   * git-tracked originals (`:ro`), so the worker CLI reads them but cannot commit them.
   *
   * @returns {{ stubDir: string|null, stubs: Array<{hostPath,containerPath,filename}>, filenames: string[] }}
   */
  async _stubWorkerGuidance(agentName, worktreePath) {
    const STUB_CONTENT = {
      'GEMINI.md': [
        '# Worker Agent',
        'You are a worker agent executing a specific coding task.',
        'Your complete instructions are in the -p prompt.',
        'Do NOT use MCP tools. Do not follow Tech Lead protocols.',
        'Execute the task, commit, and exit.',
      ].join('\n'),
      'AGENTS.md': [
        '# Worker Agent',
        'You are a worker agent executing a single task.',
        'Follow the prompt exactly and do not orchestrate other agents.',
        'Do not use MCP tools. Do not follow Tech Lead protocols.',
        'Implement, commit, report, and exit.',
      ].join('\n'),
    };

    const filesToStub = agentName === 'gemini' ? ['GEMINI.md']
      : agentName === 'codex' ? ['AGENTS.md']
      : [];

    if (filesToStub.length === 0) return { stubDir: null, stubs: [], filenames: [] };

    const stubDir = await mkdtemp(join(tmpdir(), 'worker-stubs-'));
    const stubs = [];

    for (const filename of filesToStub) {
      if (!existsSync(join(worktreePath, filename))) continue;
      const stubHostPath = join(stubDir, filename);
      await writeFile(stubHostPath, STUB_CONTENT[filename]);
      // Tell git to skip this file in `git add -A` / status checks
      await execFileAsync('git', ['update-index', '--assume-unchanged', filename], { cwd: worktreePath })
        .catch(() => {}); // non-fatal: file may not be in index yet
      stubs.push({ hostPath: stubHostPath, containerPath: `/work/${filename}`, filename });
    }

    return { stubDir, stubs, filenames: stubs.map(s => s.filename) };
  }

  /**
   * Undo `--assume-unchanged` so the file is visible to git again, then clean up
   * the tmpdir. The original git-tracked file is untouched — no checkout needed.
   *
   * @param {string} worktreePath
   * @param {{ stubDir: string|null, stubs: Array<{filename}> }} stubInfo
   */
  async _restoreWorkerGuidance(worktreePath, stubInfo) {
    if (!stubInfo?.stubs?.length) return;
    for (const stub of stubInfo.stubs) {
      await execFileAsync('git', ['update-index', '--no-assume-unchanged', stub.filename], { cwd: worktreePath })
        .catch(() => {});
    }
    if (stubInfo.stubDir) {
      await rm(stubInfo.stubDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Build the CLI prompt for an agent.
   * All worker CLIs receive the same self-contained prompt contract.
   */
  _buildPrompt(task, agentName, worktreePath) {
    // Shared full-context block — both agents get the complete picture
    const base = [
      `# Task ${task.id}: ${task.title}`,
      '',
      '## Working Directory',
      worktreePath,
      '',
      '## Full Requirements',
      task.description,
      '',
      '## Mandatory Instructions',
      '- Complete ALL requirements listed above. Do not skip or partially implement.',
      '- Write every file fully — no placeholders, no TODOs, no truncation.',
      '- Use only non-interactive shell commands (no prompts, no confirmations).',
      '- Do NOT run: npm init, git init, npx create-*, or any interactive installer.',
      '- Do NOT use save_memory or write to global config files.',
      '',
      '## Git Instructions',
      '- This directory is a git worktree. Use shell commands for all git operations.',
      '- Do NOT attempt to read the .git file directly — it is a worktree pointer.',
      '- Git identity is pre-configured — no need to set user.name or user.email.',
      '- When done: run `git add -A && git commit -m "task: ' + task.id + '"` in the working directory.',
      '',
      '## Completion Checklist (verify before committing)',
      '- [ ] All required files exist and are fully written',
      '- [ ] Code runs without syntax errors',
      '- [ ] git status shows changes staged and committed',
    ];

    if (agentName === 'gemini') {
      return [
        ...base,
        '',
        '## Reporting',
        'After committing, briefly summarise: what files you created/modified, what each does, and confirm the git commit succeeded.',
      ].join('\n');
    }

    // Claude gets the same base — no special divergence needed
    return base.join('\n');
  }

  /**
   * Run the planner to decompose a prompt.
   * Prefers Gemini (free tier). Falls back to claude CLI on host.
   */
  async _runPlanner(prompt, workDir) {
    // Try Gemini first (free tier — saves Claude quota)
    try {
      return await this._runCLI('gemini', ['-p', prompt, '--approval-mode', 'yolo'], workDir, 60_000);
    } catch {
      // Fall back to Claude
      return this._runCLI('claude', ['--print', '-p', prompt, '--output-format', 'json'], workDir, 60_000);
    }
  }

  /**
   * Run a CLI command and return stdout.
   */
  _runCLI(command, args, cwd, timeoutMs) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const cp = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      cp.stdout.on('data', d => { stdout += d; });
      cp.stderr.on('data', d => { stderr += d; });
      const timer = setTimeout(() => { cp.kill(); reject(new Error(`${command} timed out`)); }, timeoutMs);
      cp.on('exit', (code) => { clearTimeout(timer); if (code === 0) { resolve(stdout); } else { reject(new Error(command + ' exited ' + code + ': ' + stderr.slice(0, 200))); } });
      cp.on('error', reject);
    });
  }

  /**
   * Commit any uncommitted changes left in the worktree after a Docker run.
   * Skips gracefully if there is nothing to commit or git fails.
   * @param {string} worktreePath
   * @param {string} taskId
   */
  async _autoCommit(worktreePath, taskId) {
    const gitOpts = {
      cwd: worktreePath,
      timeout: 15_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'orchestrator',
        GIT_AUTHOR_EMAIL: 'orchestrator@localhost',
        GIT_COMMITTER_NAME: 'orchestrator',
        GIT_COMMITTER_EMAIL: 'orchestrator@localhost',
      },
    };
    try {
      await execFileAsync('git', ['add', '-A'], gitOpts);
      // Check if there's actually anything staged
      const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], gitOpts);
      if (!stdout.trim()) return; // nothing staged after add (e.g. only .gitignore'd files)
      await execFileAsync('git', ['commit', '-m', `task: ${taskId} (auto-commit by orchestrator)`], gitOpts);
      log.info(`  [auto-commit] ${taskId} — committed remaining changes`);
    } catch {
      // Swallow — e.g. worktree git metadata broken, nothing to commit, etc.
    }
  }

  /**
   * Get files changed in a worktree — union of:
   *   1. Uncommitted changes (git status --porcelain)
   *   2. Files committed ahead of the base branch (git diff --name-only base...HEAD)
   * This handles both agents that leave uncommitted changes AND agents that
   * properly commit their work before exiting (like Gemini).
   */
  async _getChangedFiles(worktreePath) {
    const gitOpts = { cwd: worktreePath, timeout: 5000 };
    const files = new Set();

    // 1. Uncommitted changes
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], gitOpts);
      for (const line of stdout.split('\n')) {
        const f = line.slice(3).trim();
        if (f) files.add(f);
      }
    } catch { /* ignore */ }

    // 2. Committed changes ahead of base branch
    try {
      // Find the merge-base with master/main to diff only this branch's commits
      const { stdout: mergeBase } = await execFileAsync(
        'git', ['merge-base', 'HEAD', 'master'], gitOpts
      ).catch(() => execFileAsync('git', ['merge-base', 'HEAD', 'main'], gitOpts));
      const sha = mergeBase.trim();
      if (sha) {
        const { stdout: diffOut } = await execFileAsync(
          'git', ['diff', '--name-only', sha, 'HEAD'], gitOpts
        );
        for (const f of diffOut.split('\n').map(l => l.trim()).filter(Boolean)) {
          files.add(f);
        }
      }
    } catch { /* ignore — branch may have no commits yet */ }

    return [...files];
  }

  _extractJsonArray(text) {
    try {
      const p = JSON.parse(text);
      if (Array.isArray(p)) return p;
    } catch { /* continue */ }
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('No JSON array found in planner output');
  }

  async _loadAgentsJson() {
    const path = join(this.projectRoot, 'agents.json');
    if (!existsSync(path)) return {};
    try { return JSON.parse(await readFile(path, 'utf-8')); } catch { return {}; }
  }
}

// ─── Output parsers (extracted from old adapters) ────────────────────────────

function parseClaudeOutput(stdout, stderr, duration_ms) {
  try {
    const parsed = JSON.parse(stdout);
    const isError = parsed.is_error === true;
    const summary = parsed.result ?? parsed.text ??
      (Array.isArray(parsed.content) ? parsed.content.filter(i => i.type === 'text').map(i => i.text).join('') : '') ??
      stdout.slice(0, 500);
    const token_usage = parsed.usage ? {
      input: parsed.usage.input_tokens,
      output: parsed.usage.output_tokens,
      cache_read: parsed.usage.cache_read_input_tokens,
      cost_usd: parsed.total_cost_usd,
    } : undefined;
    return { status: isError ? 'failed' : 'done', summary, filesChanged: [], output: stdout, duration_ms, token_usage };
  } catch {
    return { status: 'done', summary: stdout.slice(0, 500), filesChanged: [], output: stdout, duration_ms };
  }
}

function parseGeminiOutput(stdout, stderr, duration_ms) {
  const trimmed = stdout.trim();
  if (!trimmed) return { status: 'done', summary: '', filesChanged: [], output: stdout, duration_ms };

  // Try 3-strategy JSON extraction (handles pretty-printed, NDJSON, noisy output)
  let parsed = null;
  try { parsed = JSON.parse(trimmed); } catch { /* try next */ }
  if (!parsed && trimmed.includes('\n')) {
    for (const line of trimmed.split('\n').reverse()) {
      try { parsed = JSON.parse(line); break; } catch { /* try next */ }
    }
  }
  if (!parsed) {
    const s = trimmed.indexOf('{'), e = trimmed.lastIndexOf('}');
    if (s !== -1 && e > s) { try { parsed = JSON.parse(trimmed.slice(s, e + 1)); } catch { /* fail */ } }
  }

  if (parsed) {
    const summary = parsed.response ?? parsed.text ??
      (Array.isArray(parsed.candidates) ? parsed.candidates[0]?.content?.parts?.map(p => p.text).join('') : null) ??
      trimmed.slice(0, 500);

    // Extract token usage from --output-format json stats block
    const models = parsed.stats?.models ?? {};
    const firstModel = Object.values(models)[0];
    const token_usage = firstModel ? {
      input: firstModel.tokens?.input ?? 0,
      output: firstModel.tokens?.candidates ?? 0,
      thoughts: firstModel.tokens?.thoughts ?? 0,
      total: firstModel.tokens?.total ?? 0,
    } : undefined;

    return { status: 'done', summary, filesChanged: [], output: stdout, duration_ms, token_usage };
  }

  // Non-JSON = task likely didn't complete properly
  return {
    status: trimmed.length > 20 ? 'done' : 'failed',
    summary: trimmed.slice(0, 500),
    filesChanged: [],
    output: stdout,
    duration_ms,
  };
}

function parseCodexOutput(stdout, stderr, duration_ms) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { status: stderr?.trim() ? 'failed' : 'done', summary: stderr?.slice(0, 500) ?? '', filesChanged: [], output: stdout, duration_ms };
  }

  const events = [];
  for (const line of trimmed.split('\n')) {
    const value = line.trim();
    if (!value) continue;
    try {
      events.push(JSON.parse(value));
    } catch {
      // Ignore non-JSON lines in mixed output streams.
    }
  }

  if (events.length === 0) {
    return {
      status: 'done',
      summary: trimmed.slice(0, 500),
      filesChanged: [],
      output: stdout,
      duration_ms,
    };
  }

  let status = 'done';
  let summary = '';
  let token_usage;

  for (const event of events) {
    const eventType = String(event.type ?? '').toLowerCase();
    if (eventType.includes('error') || event.error) {
      status = 'failed';
    }

    const text = extractTextFromJson(event);
    if (text) summary = text;

    if (!token_usage) {
      const usage = event.usage ?? event.token_usage ?? event.metrics?.usage;
      if (usage) {
        token_usage = {
          input: usage.input_tokens ?? usage.input ?? 0,
          output: usage.output_tokens ?? usage.output ?? 0,
          total: usage.total_tokens ?? usage.total ?? 0,
        };
      }
    }
  }

  if (!summary) {
    summary = stderr?.trim() ? stderr.slice(0, 500) : trimmed.slice(0, 500);
  }

  return { status, summary, filesChanged: [], output: stdout, duration_ms, token_usage };
}

function extractTextFromJson(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  for (const key of ['summary', 'message', 'content', 'text', 'result']) {
    if (key in value) {
      const nested = extractTextFromJson(value[key]);
      if (nested) return nested;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractTextFromJson(item);
      if (nested) return nested;
    }
  }

  if (value.delta && typeof value.delta === 'object') {
    const nested = extractTextFromJson(value.delta);
    if (nested) return nested;
  }

  return '';
}
