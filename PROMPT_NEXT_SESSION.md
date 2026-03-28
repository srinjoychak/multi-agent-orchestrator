# Continuation Prompt — Multi-Agent Orchestrator

_Last updated: 2026-03-28_

---

## What This System Is

A **vendor-neutral AI workforce orchestrator**. Developers who pay for multiple AI
subscriptions (Claude Max, Gemini Advanced) use them as a coordinated team to complete
software engineering tasks in parallel. The Tech Lead (Claude Code or Gemini CLI)
decomposes work, dispatches it to Docker-isolated worker agents via MCP tools, reviews
diffs, and merges results.

The core value: token optimisation + parallelism. Gemini (free tier, high quota) handles
bulk work. Claude handles precision tasks. Both run in containers, isolated, observable,
killable.

---

## Architecture (current — post PR #8)

```
Claude Code / Gemini CLI (Tech Lead)
        │ MCP tools over stdio
        ▼
Orchestrator MCP Server  (node src/mcp-server/index.js)
        │
        ├── TaskManager      (src/taskmanager/index.js)
        │     SQLite at ~/.local/share/multi-agent-orchestrator-v3/tasks.db
        │     jobs table + tasks table, job-UUID scoped, retry queue, depends_on
        ├── AgentRouter      (src/router/index.js)
        │     forced_agent priority → capability filter → concurrency slot → quota
        ├── WorktreeManager  (src/worktree/index.js)
        │     git worktree per task, forks from Tech Lead's current branch
        │     prune() removes worktree + branch after accept/reject
        ├── DockerRunner     (src/docker/runner.js)
        │     spawn/kill containers, per-task isolated Gemini auth dirs
        └── Logger           (src/logger/index.js)
                │
                │  docker run --rm worker-gemini:latest / worker-claude:latest
                ▼
        Worker containers  (each gets its own git worktree mounted at /work)
```

**Key design invariants:**
- MCP tool API is the only interface. No CLI verbs.
- Workers run in Docker. No subprocess TTY hacks.
- SQLite on ext4 (`~/.local/share/`) — NOT on WSL2 DrvFs (D: drive). WAL disabled.
- Each `orchestrate()` call creates a Job UUID — tasks are scoped to that job.
- Workers fork from the Tech Lead's current branch (not hardcoded master).
- Gemini workers get a per-task isolated auth dir (only OAuth creds, no session history).

**Deleted modules (do not reference):**
- `src/merger/` — ResultMerger: dead code, removed in PR #8
- `src/monitor/` — WorkforceMonitor: dead code, removed in PR #8
- `src/tracker/` — TokenTracker: dead code, removed in PR #8
- `src/stats/` — TaskStats: dead code, removed in PR #8

---

## Current State (as of 2026-03-28)

| Component | Status | Notes |
|-----------|--------|-------|
| MCP server (single-instance) | ✅ | PID file guard, SIGTERM/SIGINT handlers |
| SQLite on ext4 | ✅ | DELETE journal, WAL cleanup on startup |
| Gemini worker (Docker) | ✅ | `--approval-mode yolo --output-format json`, `mcpServers: {}` |
| Claude worker (Docker) | ✅ | `--dangerously-skip-permissions --no-session-persistence` |
| Job UUID scoping | ✅ | `orchestrate()` creates UUID, execution loop is job-scoped |
| forced_agent routing | ✅ | Router respects it, claimTask() enforces it |
| Concurrency (3× gemini, 1× claude) | ✅ | `_runningCounts` map in orchestrator |
| Worktree branching | ✅ | Workers fork from Tech Lead's current branch |
| task_reset MCP tool | ✅ | Clears SQLite + all worktrees without restarting server |
| Prune on accept | ✅ | `acceptTask()` calls `worktreeManager.prune()` after merge |
| Prune on reject | ✅ | `rejectTask()` calls `worktreeManager.prune()` before re-queue |
| Per-task Gemini auth isolation | ✅ | `runner.js` creates temp dir with creds only — no session leakage |
| Logger | ✅ | `src/logger/index.js` — stderr only, DEBUG gate, child() |
| 89 unit + integration tests | ✅ | 0 failures |
| E2E test run | ✅ | Validated 2026-03-28: 4-task job completed end-to-end |
| Worktree cleanup docs | ✅ | `.agent/TECH-LEAD.md` — Worktree Cleanup section |

---

## Completed Work — Old TODO Items Now Done

These were in the previous PROMPT_NEXT_SESSION.md as open tasks. They are done:

| Item | Done |
|------|------|
| Add `task_reset` MCP tool | ✅ `src/mcp-server/tools.js` case `task_reset` |
| End-to-end test | ✅ Validated 2026-03-28 |
| Prune on reject (Fix A) | ✅ `core.js rejectTask()` calls `worktreeManager.prune()` |
| Prune-on-accept | ✅ `core.js acceptTask()` calls `worktreeManager.prune()` |
| Remove dead modules | ✅ merger/monitor/tracker/stats all deleted |
| Wire WorkforceMonitor | N/A — module deleted; `workforce_status` returns docker ps directly |

---

## Active Gaps — v1 Readiness (prioritised)

These are the gaps between current state and a reliable v1. Ordered by impact.

---

### Gap 1 — GEMINI.md auto-loaded by worker containers [HIGH]

**File:** `src/orchestrator/core.js` → `_runTask()`
**Root cause:** `GEMINI.md` is tracked in git and exists in every task worktree mounted at
`/work`. Gemini CLI auto-loads `GEMINI.md` from its cwd on startup. Workers therefore
receive Tech Lead instructions (MCP tools, branching protocol) as system context before
they read the `-p` task prompt. This causes workers to behave like Tech Leads — using MCP
tools, referencing other files, deviating from the task.

**Observed symptom (E2E 2026-03-28):** T4 reimplemented the whole server using the
project's own `TaskManager` because it read GEMINI.md → TECH-LEAD.md → understood the
project's internal architecture and "over-applied" it.

**Fix:** Before spawning the container, overwrite `GEMINI.md` in the worktree with a
minimal worker-safe stub. The file must be reset afterward so it is not committed as a
change.

In `src/orchestrator/core.js`, inside `_runTask()`, after `worktreeManager.create()` and
before `docker.run()`:

```js
// Import at top of file (already have writeFile from earlier imports if needed):
import { writeFile } from 'node:fs/promises';

// In _runTask(), after worktreePath is known:
if (agentName === 'gemini') {
  await writeFile(
    join(worktreePath, 'GEMINI.md'),
    [
      '# Worker Agent',
      'You are a worker agent executing a specific coding task.',
      'Your complete instructions are in the -p prompt.',
      'Do NOT use MCP tools. Do not follow Tech Lead protocols.',
      'Execute the task, commit, and exit.',
    ].join('\n')
  );
}
```

Then in `_autoCommit()` (or just before `docker.run()` returns), reset the file so it is
not committed:

```js
// After docker.run() completes, before returning:
await execFileAsync('git', ['checkout', '--', 'GEMINI.md'], { cwd: worktreePath })
  .catch(() => {}); // no-op if GEMINI.md was never tracked in this worktree
```

**Test scenario:**
1. Run `orchestrate('Write a hello world Node.js script in src/hello.js')`.
2. Check `task_logs(T1)` — Gemini response should NOT mention `orchestrate`, `task_accept`,
   `task_reject`, or any MCP tool names.
3. `task_diff(T1)` should show only `src/hello.js` — not a modified `GEMINI.md`.

---

### Gap 2 — Planner uses `-y` flag (silently enables sandbox) [HIGH]

**File:** `src/orchestrator/core.js` line 574
**Current code:**
```js
return await this._runCLI('gemini', ['-p', prompt, '-y'], workDir, 60_000);
```
**Problem:** `-y` silently enables Gemini CLI's sandbox mode. The documented standard
(AGENTS.md) explicitly states: "Use `--approval-mode yolo` (not `-y`) — `-y` silently
enables sandbox which breaks Docker-in-Docker." The planner runs on the host, so sandbox
doesn't break Docker-in-Docker here, but `-y` is still wrong-per-spec and will break if
the planner ever moves into a container.

**Fix:**
```js
return await this._runCLI('gemini', ['-p', prompt, '--approval-mode', 'yolo'], workDir, 60_000);
```

**Test scenario:**
1. Ensure `gemini --version` works on the host.
2. Call `orchestrate('Build a utility that reads a JSON file and prints a summary')`.
3. Decomposition should succeed (tasks appear on the board). Previously this was passing
   despite the flag, but it should still be fixed for correctness.

---

### Gap 3 — Decomposition is context-blind [HIGH]

**File:** `src/orchestrator/core.js` → `decomposeTasks()` lines 165–178
**Root cause:** The planner prompt contains only the user's request. It has no knowledge of:
- The project's module system (`"type": "module"` — ESM, not CommonJS)
- Which files already exist (workers overwrote existing files or used wrong import syntax)
- The tech stack (Node.js, better-sqlite3, no test framework, uses `node:test`)

**Observed symptoms (E2E 2026-03-28):**
- T3 wrote `const app = require('./server')` (CJS) in an ESM project
- T4 rewrote `server.js` from scratch using the project's internal `TaskManager`
  because it could see the project's existing code structure

**Fix:** Inject a project context block into `planPrompt` before calling `_runPlanner()`.
Gather it cheaply with shell commands:

```js
// In decomposeTasks(), before building planPrompt:
let projectContext = '';
try {
  const { stdout: pkgRaw } = await execFileAsync('cat', ['package.json'], { cwd: this.projectRoot });
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
```

Then append `projectContext` to the planPrompt string.

**Also add to the planner rules:**
```
6. In each task description, list the exact files the task will create or modify.
7. No two tasks may list the same file — tasks that share files must use depends_on.
```

**Test scenario — file conflict prevention:**
1. Call `orchestrate('Build an Express REST API: GET /health, GET /items, POST /items')`.
2. Inspect the raw plan (add a debug log before `taskManager.addTasks()`).
3. Verify no two tasks list the same file path in their descriptions.
4. All tasks should complete without merge conflicts on accept.

**Test scenario — ESM awareness:**
1. Call `orchestrate('Add a utility function in src/utils/format.js that formats a date')`.
2. Accept the task.
3. `node src/utils/format.js` should not throw `SyntaxError: require is not defined`.

---

### Gap 4 — No `task_discard` operation [MEDIUM]

**Problem:** `task_reject(id, reason)` always re-queues the task. When the Tech Lead wants
to discard a completed task (because it was manually implemented, or its output is
entirely wrong and not worth retrying), there is no clean operation. Using `task_reject`
causes board pollution — rejected tasks stay in `pending` indefinitely after `orchestrate()`
returns.

**Observed impact (E2E 2026-03-28):** Had to reject T2, T3, T4 knowing they would re-queue
with no worker ever picking them up, leaving 3 zombie-pending tasks on the board.

**Fix — add `task_discard` MCP tool:**

In `src/mcp-server/tools.js`, add to the tools array:
```js
{
  name: 'task_discard',
  description: 'Permanently discard a completed task without re-queuing. Use when output is manually handled or the task is no longer needed.',
  inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Task ID' } }, required: ['id'] }
}
```

Add handler in the switch:
```js
case 'task_discard': {
  const result = await orchestrator.discardTask(args.id);
  return { task_id: args.id, ...result };
}
```

In `src/orchestrator/core.js`, add `discardTask()`:
```js
async discardTask(taskId) {
  const task = await this.taskManager.getTask(taskId);
  if (task.assigned_to) {
    await this.worktreeManager.prune(taskId, task.assigned_to).catch(() => {});
  }
  // Force to failed with retries exhausted so it cannot be re-queued
  await this.taskManager.db.prepare(
    `UPDATE tasks SET status = 'failed', retries = max_retries WHERE id = ?`
  ).run(taskId);
  return { discarded: true };
}
```

**Test scenario:**
1. Run `orchestrate('Write src/scratch.js with a console.log')`. Task completes.
2. Call `task_discard('T1')`.
3. Call `task_status()` — T1 should show `status: failed` with `retries === max_retries`.
4. Call `orchestrate('another task')` — T1 should NOT re-appear or be retried.
5. `git worktree list` — no stale worktree for T1.

---

### Gap 5 — End-of-job worktree sweep [MEDIUM]

**File:** `src/orchestrator/core.js` → `executeTasks()`
**Problem:** After the execution loop exits, tasks that failed permanently (max retries
exhausted) leave their worktrees and branches alive. `task_accept` prunes on accept,
`task_reject` prunes on reject, but tasks that simply fail with no accept/reject action
are never cleaned up by the loop itself.

**Fix:** After the `while (true)` loop exits in `executeTasks()`, sweep any permanently
failed tasks:

```js
// After the while loop, before returning allTasks:
const finalTasks = await getTasks();
for (const t of finalTasks) {
  if (t.status === 'failed' && t.assigned_to && t.retries >= t.max_retries) {
    await this.worktreeManager.prune(t.id, t.assigned_to).catch(() => {});
  }
}
```

**Test scenario:**
1. Call `orchestrate('Write a file that requires a nonexistent package: require("nonexistent-xyz")')`.
   (This should cause the worker to fail repeatedly.)
2. Wait for the task to exhaust retries.
3. `git worktree list` — should show only the main worktree, no stale `.worktrees/` entries.
4. `git branch --list 'agent/*'` — should be empty.

---

### Gap 6 — `task_kill` does not prune worktree [MEDIUM]

**File:** `src/orchestrator/core.js` → `killTask()` lines 425–433
**Current code:**
```js
async killTask(taskId) {
  const task = await this.taskManager.getTask(taskId);
  if (!task.container_id) return { killed: false };
  const killed = await this.docker.kill(task.container_id);
  if (killed) {
    await this.taskManager.updateStatus(taskId, 'failed').catch(() => {});
  }
  return { killed, container_id: task.container_id };
}
```
**Problem:** Killing a task marks it `failed` but leaves its worktree and branch alive.
After `task_kill`, `git worktree list` shows a stale entry.

**Fix:**
```js
async killTask(taskId) {
  const task = await this.taskManager.getTask(taskId);
  if (!task.container_id) return { killed: false };
  const killed = await this.docker.kill(task.container_id);
  if (killed) {
    await this.taskManager.updateStatus(taskId, 'failed').catch(() => {});
    if (task.assigned_to) {
      await this.worktreeManager.prune(taskId, task.assigned_to).catch(() => {});
    }
  }
  return { killed, container_id: task.container_id };
}
```

**Test scenario:**
1. Run a long-running task (e.g., `orchestrate('Run: sleep 120')`).
2. While it is running, call `task_kill('T1')`.
3. `task_status('T1')` → `status: failed`.
4. `git worktree list` → no stale entry for T1.
5. `git branch --list 'agent/gemini/T1'` → empty.

---

### Gap 7 — agents.json not hot-reloaded [LOW]

**File:** `src/orchestrator/core.js` → `initialize()` lines 104–115
**Problem:** `agents.json` is loaded once at `initialize()` time (server startup). Changes
to quotas, concurrency, or capabilities require a full MCP server restart to take effect.

**Fix:** Move the agents.json load into `orchestrate()` so it re-reads on each job:

```js
// In orchestrate(), before decomposeTasks():
const agentsJson = await this._loadAgentsJson();
for (const [name, defaults] of Object.entries(DEFAULT_AGENTS)) {
  const override = agentsJson[name] ?? {};
  this.agents.set(name, { ...defaults, ...override, name });
}
// Rebuild router with updated config
const adapterMap = new Map(
  Array.from(this.agents.entries()).map(([name, cfg]) => [name, { capabilities: cfg.capabilities }])
);
this.router = new AgentRouter(adapterMap, Object.fromEntries(this.agents));
```

**Test scenario:**
1. Start the MCP server.
2. Change `gemini.quota` in `agents.json` from 70 to 50.
3. Call `orchestrate('some task')`.
4. The router should use the new quota without restarting the server.
5. (Verify by checking which agent gets assigned in `task_status()`.)

---

### Gap 8 — retryDue() never called during execution [LOW]

**File:** `src/orchestrator/core.js` → `executeTasks()`
**Problem:** `TaskManager.retryDue()` exists (it promotes tasks whose retry backoff has
expired from a hypothetical `retry_after` queue back to `pending`) but is never called
during the execution loop. Backoff retries never fire automatically.

**Fix:** Call `retryDue()` once per poll iteration inside the `while (true)` loop:

```js
// Near the top of each while iteration, after getTasks():
await this.taskManager.retryDue().catch(() => {});
```

**Note:** Verify that `retryDue()` in `src/taskmanager/index.js` is idempotent and safe to
call every 2 seconds before wiring it in. Add a test if not already covered.

---

### Gap 9 — Host-side Gemini planner session cache accumulates [LOW]

**Problem:** The planner (`_runPlanner`) calls `gemini` on the host in a temp directory
(`~/.gemini/tmp/orch-plan-*/`). These sessions are never cleaned up. Over many runs,
`~/.gemini/tmp/` fills up with hundreds of stale session dirs.

The per-task worker auth isolation fix (PR #9) addresses this for worker containers.
The host-side planner is not affected by that fix.

**Fix:** Update `reset-state` in `package.json` to also prune host planner sessions:

```json
"reset-state": "npm run kill-mcp 2>/dev/null; git worktree list --porcelain | grep '^worktree ' | grep '.worktrees' | awk '{print $2}' | xargs -r -n 1 git worktree remove --force 2>/dev/null; git branch --list 'agent/*' | tr -d ' +*' | xargs -r -n 1 git branch -D 2>/dev/null; rm -rf ~/.local/share/multi-agent-orchestrator-v3 ~/.gemini/tmp/orch-plan-* && echo 'State cleared'"
```

Note: do NOT delete `~/.gemini/tmp/work` here — that is handled per-task by the runner.

---

## Full Test Scenarios for v1 Validation

Run these in order after implementing the gaps above. All must pass before calling it v1.

---

### Scenario A — Clean single-task happy path
```
orchestrate('Create src/utils/slugify.js — export a default function slugify(str) that
lowercases the string and replaces spaces with hyphens. ESM syntax. No dependencies.')
```
**Expected:**
- 1 task created, assigned (gemini or claude)
- `task_diff(T1)` shows only `src/utils/slugify.js`
- No GEMINI.md change in the diff
- `task_logs(T1)` contains no references to MCP tools or Tech Lead protocol
- `task_accept(T1)` succeeds, no conflicts
- `git worktree list` — only main worktree after accept
- `npm test` — still 89 pass, 0 fail

---

### Scenario B — Multi-task parallel job (file conflict prevention)
```
orchestrate('Build a simple calculator module:
- src/calc/add.js: exports add(a, b)
- src/calc/subtract.js: exports subtract(a, b)
- src/calc/index.js: re-exports add and subtract
- test/calc.test.js: tests all three using node:test and assert')
```
**Expected:**
- 4 tasks created. Each task targets different files (no overlap).
- Tasks with `depends_on` (index.js depends on add.js and subtract.js) must not be
  dispatched until their dependencies are done.
- All 4 tasks complete without merge conflicts.
- `npm test` passes with new tests included.

**Failure mode to watch for:** If T2 and T3 both write `src/calc/index.js`, decomposition
is still broken (Gap 3 not properly fixed).

---

### Scenario C — Task failure + worktree cleanup
```
orchestrate('Write src/intentional_fail.js that imports from "this-package-does-not-exist"')
```
**Expected:**
- Task fails (worker can't install missing package / node throws on import).
- After max retries exhausted: `task_status(T1)` → `status: failed`.
- `git worktree list` → only main worktree (end-of-job sweep prunes it).
- `git branch --list 'agent/*'` → empty.

---

### Scenario D — task_kill cleanup
1. `orchestrate('Write a script that logs "hello" every second for 200 seconds')`.
2. While running: `task_kill('T1')`.
3. **Expected:** `task_status('T1').status === 'failed'`.
4. `git worktree list` — no stale worktree.
5. `git branch --list 'agent/gemini/T1'` — empty.

---

### Scenario E — task_discard
1. `orchestrate('Write src/scratch.js')`. Task completes.
2. Manually write `src/scratch.js` yourself.
3. `task_discard('T1')`.
4. **Expected:** `task_status('T1').status === 'failed'` with retries === max_retries.
5. Call `orchestrate('another prompt')` — T1 does not reappear.
6. `git worktree list` — no stale entry for T1.

---

### Scenario F — GEMINI.md worker isolation
1. `orchestrate('Write src/greet.js: export default function greet(name) { return "Hello " + name; }')`.
2. Confirm it goes to a Gemini worker.
3. `task_logs(T1)` — grep output for: `orchestrate`, `task_accept`, `task_reject`, `MCP`, `Tech Lead`.
4. **Expected:** None of those strings appear. Worker output should discuss only the code task.
5. `task_diff(T1)` — GEMINI.md should NOT appear in changed files.

---

### Scenario G — agents.json hot-reload (after Gap 7 fix)
1. Start the MCP server fresh.
2. Edit `agents.json` — change `gemini.quota` to `10` (forces almost all tasks to claude).
3. Without restarting the MCP server, call `orchestrate('Write src/ping.js')`.
4. **Expected:** Task assigned to claude-code (quota forces it) without a server restart.

---

## Definition of Done (v1)

- [ ] Scenario A–G all pass with 0 manual file edits required
- [ ] A 4-task parallel job completes with 0 merge conflicts on accept
- [ ] `task_logs` for any Gemini worker contains no MCP tool references (GEMINI.md isolation works)
- [ ] After any job completes, `git worktree list` shows only the main worktree
- [ ] After `task_kill`, worktree is immediately pruned
- [ ] `task_discard` exists and closes a task without re-queuing
- [ ] `npm test` ≥ 95 pass, 0 fail (existing 89 + new tests for discard, kill-prune, end-of-job sweep)
- [ ] No direct commits to master — all work via feature branches

---

## Branching Protocol (mandatory)

```bash
# Start of every session:
git checkout master && git pull
git checkout -b feat/<short-description>

# After all tasks accepted and npm test passes:
git checkout master
git merge --no-ff feat/<short-description> -m "feat: <description>"
```

Workers fork from your current branch. `task_accept(id)` merges the worker branch into
your feature branch. Only you merge to master.

---

## Worktree Cleanup (run after every job)

```bash
# Remove all task worktrees
git worktree list --porcelain \
  | grep '^worktree ' | grep '\.worktrees' \
  | awk '{print $2}' \
  | xargs -r -n1 git worktree remove --force

# Delete all agent/* branches
git branch --list 'agent/*' | tr -d ' +*' | xargs -r -n1 git branch -D
```

Or: `npm run reset-state` (also clears SQLite state and kills MCP server).

---

## MCP Tools Quick Reference

```
orchestrate(prompt)          — decompose + assign + execute full pipeline
task_status(id?)             — live board (all tasks) or single task detail
task_diff(id)                — git diff of completed worktree vs base
task_accept(id)              — merge worker branch into current HEAD + prune
task_reject(id, reason)      — re-queue with rejection appended to description + prune
task_discard(id)             — permanently close task, no re-queue [TO BE ADDED]
task_logs(id, tail?)         — last N lines of container stdout/stderr
task_kill(id)                — force-stop container + prune worktree [prune TO BE FIXED]
workforce_status()           — all running containers + task summary
task_reset()                 — hard reset: clear DB + all worktrees
```

---

## Key File Locations

```
src/mcp-server/index.js          — MCP server entry point + single-instance guard
src/mcp-server/tools.js          — MCP tool handlers (add task_discard here)
src/orchestrator/core.js         — orchestrate(), executeTasks(), decomposeTasks(), _buildPrompt()
  line 165-178                   — planPrompt construction (inject project context here)
  line 452-530                   — _runTask() (inject worker GEMINI.md override here)
  line 393-399                   — rejectTask() ✅ already prunes
  line 379-386                   — acceptTask() ✅ already prunes
  line 425-433                   — killTask() ← needs worktree prune added
  line 574                       — _runPlanner() ← fix -y flag
src/taskmanager/index.js         — SQLite state machine, retryDue(), job scoping
src/router/index.js              — agent selection logic
src/worktree/index.js            — git worktree lifecycle (create/merge/prune/reset)
src/docker/runner.js             — container spawn/kill/logs, _isolatedGeminiAuth()
agents.json                      — agent capabilities, quota, concurrency
CLAUDE.md                        — Tech Lead instructions (Claude Code auto-loads)
GEMINI.md                        — Tech Lead instructions (Gemini CLI auto-loads from cwd)
AGENTS.md                        — worker prompt standards (read before writing any worker prompt)
.agent/TECH-LEAD.md              — full Tech Lead role definition
```

---

## How to Run Tests

```bash
npm test                          # all 89 tests (src/**/*.test.js + tests/**/*.test.js)
node --test src/taskmanager/*.test.js   # TaskManager only
node tests/integration/taskmanager.integration.test.js   # integration only
```

## How to Start the MCP Server

```bash
npm run kill-mcp 2>/dev/null
node src/mcp-server/index.js &
# Or let Claude Code start it via ~/.claude/settings.json mcpServers registration
```
