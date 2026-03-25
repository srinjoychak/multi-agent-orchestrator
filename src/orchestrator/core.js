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
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { TaskManager } from '../taskmanager/index.js';
import { DockerRunner } from '../docker/runner.js';
import { WorktreeManager } from '../worktree/index.js';
import { AgentRouter } from '../router/index.js';
import { ResultMerger } from '../merger/index.js';

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
    timeoutMs: 120_000,
    cliArgs: (prompt) => ['-p', prompt, '-y'],
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
};

export class Orchestrator {
  /**
   * @param {string} projectRoot
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=2000]
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = resolve(projectRoot);
    this.stateDir = join(this.projectRoot, '.agent-team');
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;

    this.taskManager = new TaskManager(this.stateDir);
    this.docker = new DockerRunner();
    this.worktreeManager = new WorktreeManager(this.projectRoot);
    this.merger = new ResultMerger(this.projectRoot, join(this.stateDir, 'results'));

    /** @type {Map<string, Object>} agentName -> agent config */
    this.agents = new Map();
    this.router = null;
  }

  /**
   * Initialize: load agent config, verify Docker, set up directories.
   * @param {Object} [options]
   * @param {boolean} [options.quiet=false]
   */
  async initialize(options = {}) {
    if (!options.quiet) {
      console.log('');
      console.log('Multi-Agent Orchestrator v3');
      console.log('');
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
      this.agents.set(name, { ...defaults, ...override, name });
    }

    // Build adapter-like objects for the router
    const adapterMap = new Map(
      Array.from(this.agents.entries()).map(([name, cfg]) => [name, { capabilities: cfg.capabilities }])
    );
    this.router = new AgentRouter(adapterMap, Object.fromEntries(this.agents));

    if (!options.quiet) {
      console.log(`  Agents: ${Array.from(this.agents.keys()).join(', ')}`);
      console.log(`  State: ${this.stateDir}`);
      console.log('');
    }
  }

  /**
   * Decompose a user prompt into discrete tasks using a planner.
   * Uses Gemini for decomposition (free tier) to save Claude quota.
   * @param {string} userPrompt
   * @returns {Promise<Object[]>}
   */
  async decomposeTasks(userPrompt) {
    // Short-circuit: very short prompts are single tasks
    if (userPrompt.length < 200 && !userPrompt.includes('\n')) {
      return this.taskManager.addTasks([{
        id: 'T1',
        title: userPrompt.slice(0, 80),
        description: userPrompt,
        type: 'code',
      }]);
    }

    const planPrompt = [
      'Decompose the following software engineering request into discrete, parallelizable tasks.',
      '',
      'Rules:',
      '1. Return ONLY a valid JSON array — no prose, no markdown.',
      '2. Each task must be completable by one agent working alone in its own directory.',
      '3. Tasks must NOT touch the same files.',
      '4. Express dependencies via "depends_on": ["T1"].',
      '5. type must be one of: code, refactor, test, review, debug, research, docs, analysis',
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
        parsed.map(t => ({ ...t, type: VALID_TYPES.has(t.type) ? t.type : 'code' }))
      );
    } catch {
      console.error('[orchestrator] Decompose failed, creating single task');
      return this.taskManager.addTasks([{
        id: 'T1',
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
        console.log(`  [assign] ${task.id} "${task.title}" -> ${agentName}`);
      } catch (err) {
        console.error(`  [assign] Failed to assign ${task.id}: ${err.message}`);
      }
    }
    return assigned;
  }

  /**
   * Execute all tasks in dependency-aware parallel waves.
   */
  async executeTasks() {
    const dispatched = new Set();

    while (true) {
      const allTasks = await this.taskManager.getTasks();

      // Fail tasks whose dependencies failed
      for (const task of allTasks.filter(t => t.status === 'pending')) {
        const failedDep = task.depends_on.find(depId => {
          const dep = allTasks.find(t => t.id === depId);
          return dep?.status === 'failed';
        });
        if (failedDep) {
          await this.taskManager.updateStatus(task.id, 'failed');
        }
      }

      if (await this.taskManager.isAllComplete()) break;

      const readyTasks = allTasks.filter(t => {
        if (t.status !== 'pending') return false;
        return t.depends_on.every(depId => allTasks.find(x => x.id === depId)?.status === 'done');
      });

      const inProgress = allTasks.filter(t => t.status === 'in_progress' && !dispatched.has(t.id));
      const toRun = [...inProgress];

      if (readyTasks.length > 0) {
        await this.assignTasks(readyTasks);
        const refreshed = await this.taskManager.getTasks();
        const newlyReady = refreshed.filter(t =>
          readyTasks.some(r => r.id === t.id) && t.status === 'in_progress' && !dispatched.has(t.id)
        );
        toRun.push(...newlyReady);
      }

      if (toRun.length > 0) {
        console.log(`  [wave] starting ${toRun.map(t => t.id).join(', ')}`);
        toRun.forEach(t => dispatched.add(t.id));
        await Promise.all(toRun.map(t => this._runTask(t)));
        toRun.forEach(t => dispatched.delete(t.id));
      } else {
        const s = await this.taskManager.getSummary();
        console.log(`  [progress] done=${s.done} running=${s.in_progress} pending=${s.pending} failed=${s.failed}`);
        await new Promise(r => setTimeout(r, this.pollIntervalMs));
      }
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
   * Re-queue a task with rejection reason.
   * @param {string} taskId
   * @param {string} reason
   */
  async rejectTask(taskId, reason) {
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
    }
    return { killed, container_id: task.container_id };
  }

  /** Hard reset: remove all worktrees, clear task state. */
  async reset() {
    await this.worktreeManager.reset();
    this.taskManager.clear();
    console.log('[orchestrator] Hard reset complete');
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
      console.error(`  [error] No agent config for ${agentName}`);
      return;
    }

    try {
      // Create worktree
      const { path: worktreePath } = await this.worktreeManager.create(task.id, agentName);

      // Write task context file — use a name that won't collide with project files
      // (CLAUDE.md / GEMINI.md are reserved for project-level instructions)
      const ctxFile = '.task-context.md';
      const ctxContent = this._buildContextFile(task, agentName, worktreePath);
      await writeFile(join(worktreePath, ctxFile), ctxContent, 'utf-8');

      // Build CLI prompt
      const prompt = this._buildPrompt(task, agentName, worktreePath);
      const cliArgs = agentCfg.cliArgs(prompt);

      console.log(`  [exec] ${task.id} via ${agentName} in Docker`);
      const containerName = `worker-${agentName}-${task.id}`;
      // Record container_id without status change — assignTasks already set in_progress
      this.taskManager.db.prepare('UPDATE tasks SET container_id = ? WHERE id = ?')
        .run(containerName, task.id);

      // Run in Docker
      const runResult = await this.docker.run({
        taskId: task.id,
        agentName,
        worktreePath,
        cliArgs,
        options: { timeoutMs: agentCfg.timeoutMs, image: agentCfg.image },
      });

      // Parse output
      const parsed = agentCfg.parseOutput(runResult.stdout, runResult.stderr, runResult.duration_ms);

      // Detect changed files via git status in worktree
      const filesChanged = await this._getChangedFiles(worktreePath);
      parsed.filesChanged = filesChanged;

      // Auto-commit any uncommitted changes the agent left behind.
      // Agents are instructed to commit but may fail (no git identity in container,
      // crash before commit, etc.). This ensures task_diff always has something to show.
      if (filesChanged.length > 0) {
        await this._autoCommit(worktreePath, task.id);
      }

      const finalStatus = runResult.exitCode === 0 && parsed.status !== 'failed' ? 'done' : 'failed';
      const extraFields = parsed.token_usage ? { token_usage: parsed.token_usage } : {};
      await this.taskManager.updateStatus(task.id, finalStatus, extraFields);

      console.log(`  [${finalStatus}] ${task.id} (${runResult.duration_ms}ms, ${filesChanged.length} files changed)`);
      return parsed;

    } catch (err) {
      console.error(`  [error] ${task.id}: ${err.message}`);
      // Attempt retry
      const retried = await this.taskManager.retryTask(task.id);
      if (retried) {
        console.log(`  [retry] ${task.id} (attempt ${retried.retries})`);
      } else {
        await this.taskManager.updateStatus(task.id, 'failed').catch(() => {});
      }
    }
  }

  /**
   * Build the task context file content for an agent.
   */
  _buildContextFile(task, agentName, worktreePath) {
    return [
      `# Task Context — ${task.id}`,
      '',
      `**Task:** ${task.title}`,
      `**Type:** ${task.type}`,
      '',
      '## Objective',
      task.description,
      '',
      '## Constraints',
      `- Work only within: ${worktreePath}`,
      '- Do NOT modify files outside this worktree.',
      '- Do NOT use save_memory or write to global config files.',
      '- When done, commit your changes with: git add -A && git commit -m "task: ' + task.id + '"',
    ].join('\n');
  }

  /**
   * Build the CLI prompt for an agent.
   * Gemini reads GEMINI.md natively — keep prompt minimal.
   * Claude needs the full context in the prompt.
   */
  _buildPrompt(task, agentName, worktreePath) {
    if (agentName === 'gemini') {
      return `Task: ${task.title}\n\nPlease complete the task described in .task-context.md. Commit all changes when done.`;
    }
    return [
      `Task: ${task.title}`,
      '',
      task.description,
      '',
      `Working directory: ${worktreePath}`,
      '',
      'Instructions:',
      '- Complete the task described above.',
      '- Only modify files relevant to this task.',
      '- Run git add -A && git commit when done.',
    ].join('\n');
  }

  /**
   * Run the planner to decompose a prompt.
   * Prefers Gemini (free tier). Falls back to claude CLI on host.
   */
  async _runPlanner(prompt, workDir) {
    // Try Gemini first (free tier — saves Claude quota)
    try {
      return await this._runCLI('gemini', ['-p', prompt, '-y'], workDir, 60_000);
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
      cp.on('exit', () => { clearTimeout(timer); resolve(stdout); });
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
      console.log(`  [auto-commit] ${taskId} — committed remaining changes`);
    } catch {
      // Swallow — e.g. worktree git metadata broken, nothing to commit, etc.
    }
  }

  /**
   * Get files changed in a worktree (git status --porcelain).
   */
  async _getChangedFiles(worktreePath) {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: 5000 });
      return stdout.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
    } catch {
      return [];
    }
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
    return { status: 'done', summary, filesChanged: [], output: stdout, duration_ms };
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
