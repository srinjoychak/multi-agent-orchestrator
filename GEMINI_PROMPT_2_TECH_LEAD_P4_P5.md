# Gemini Tech Lead: Execute P4 (Phase 3 Modules) and P5 (E2E Tests)

**Role**: You are the **Tech Lead** of the Multi-Agent Orchestrator v3. You will use the orchestrator's MCP tools to dispatch work to Gemini worker agents, review their output, and merge results.
**Working directory**: `/mnt/d/ALL_AUTOMATION/copilot_adapter`
**Branch**: `master`

---

## Your Mission

You will dispatch **5 tasks** to Gemini worker agents via the `orchestrate()` MCP tool, review each result via `task_diff()`, and merge via `task_accept()`. All work is performed by Gemini workers inside Docker containers — you do NOT write code yourself.

**End state**: master branch has 6 new source files, ~110+ tests passing, 0 failures.

---

## Prerequisites — Verify Before Starting

Run these checks. If any fail, stop and report.

```bash
# 1. Clean git state
git status  # must be clean
git log --oneline -3  # latest commit should be the R1-R5 reliability fix

# 2. Tests pass
npm test  # must show >= 83 tests, 0 failures

# 3. Docker available
docker info  # must succeed

# 4. Worker images exist
docker images | grep worker-gemini  # must show worker-gemini:latest

# 5. Clear stale task DB
rm -f .agent-team/tasks.db

# 6. No stale worktrees
git worktree list  # should show only the main worktree

# 7. Verify agents.json routes 100% to Gemini
cat agents.json  # claude-code quota must be 0, gemini quota must be 70
```

---

## Critical Rules for Dispatching Work

1. **ONE module per `orchestrate()` call.** Never combine multiple modules in one prompt. The planner will over-decompose and workers will produce conflicting files.

2. **Include the FULL interface spec inline in the prompt.** Do not reference external files — the worker reads TASK_CONTEXT.md which is generated from your prompt. If you say "see GEMINI_TASK_P4.md" the worker can't read it (it's in .gitignore).

3. **Each prompt must say "This is a SINGLE task — do NOT decompose into subtasks."** This prevents the planner from splitting one module into 3 overlapping tasks.

4. **Each prompt must include the test file.** Source + tests in the same task avoids interface mismatches.

5. **After each task completes**: run `task_status()`, then `task_diff(id)` to review, then `task_accept(id)` to merge. Verify `npm test` passes after each merge before dispatching the next task.

6. **If a merge conflicts on TASK_CONTEXT.md**: This should not happen after R1 fix. If it does, resolve with:
   ```bash
   git checkout --theirs TASK_CONTEXT.md && git add TASK_CONTEXT.md && git commit --no-edit
   ```
   Then delete TASK_CONTEXT.md: `rm TASK_CONTEXT.md && git add -A && git commit -m "cleanup: remove TASK_CONTEXT.md"`

---

## Task 1 of 5: P4 — TokenTracker Tests (`src/tracker/tracker.test.js`)

The implementation `src/tracker/index.js` already exists on master. Only the test file is missing.

**Dispatch this prompt via `orchestrate()`:**

```
This is a SINGLE task. Do NOT decompose into subtasks.

Create the file src/tracker/tracker.test.js — unit tests for the existing src/tracker/index.js TokenTracker class.

FIRST: Read src/tracker/index.js to understand the existing implementation. Also read src/taskmanager/taskmanager.test.js to understand the test patterns used in this project (makeTestEnv, node:test, node:assert/strict).

The TokenTracker class has these methods:
- constructor(taskManager) — takes a TaskManager instance
- parseClaude(stdout) — returns {input, output, cache_read, cost_usd} or null
- parseGemini(stdout, prompt) — returns {input_est, output_est, cost_usd: 0}
- async record(taskId, usage) — writes token_usage JSON to SQLite
- async summaryByAgent() — returns array of {agent, task_count, total_input, total_output, total_cost_usd}
- async totalCost() — returns {totalCost, taskCount}

Write these test cases using node:test (describe, it, before, after) and node:assert/strict:

1. parseClaude with valid JSON containing usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, total_cost_usd → returns correct object
2. parseClaude with JSON on one line among other lines → finds and parses it
3. parseClaude with empty string → returns null
4. parseClaude with invalid JSON → returns null
5. parseGemini estimates tokens as Math.ceil(string.length / 4), cost_usd is always 0
6. parseGemini with empty strings → returns {input_est: 0, output_est: 0, cost_usd: 0}
7. record writes token_usage to SQLite — use makeTestEnv pattern, addTask first, then record, then verify via db.prepare SELECT
8. summaryByAgent aggregates across multiple tasks with different agents
9. totalCost sums cost_usd across all tasks

Use this makeTestEnv pattern (same as taskmanager.test.js):
```javascript
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TaskManager } from '../taskmanager/index.js';

async function makeTestEnv() {
  const dir = join(tmpdir(), `tracker-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const manager = new TaskManager(dir);
  await manager.initialize();
  return { dir, manager, cleanup: async () => { manager.close(); await rm(dir, { recursive: true, force: true }); } };
}
```

For tests 7-9: add tasks via manager.addTask(), then claim and set to in_progress and done (to set assigned_to), then call tracker.record() to set token_usage.

Run npm test after creating the file. All tests must pass with 0 failures.
Commit: git add -A && git commit -m "test: add TokenTracker unit tests"
```

**After completion**: `task_diff()` → verify only `src/tracker/tracker.test.js` was created. `task_accept()` → merge. Run `npm test` → expect ~94 tests, 0 failures.

---

## Task 2 of 5: P4 — WorkforceMonitor (`src/monitor/index.js` + `src/monitor/monitor.test.js`)

**Dispatch this prompt via `orchestrate()`:**

```
This is a SINGLE task. Do NOT decompose into subtasks.

Create TWO files:
1. src/monitor/index.js — WorkforceMonitor class
2. src/monitor/monitor.test.js — unit tests

FIRST: Read src/docker/runner.js to see the DockerRunner interface (listWorkers, logs, kill methods). Read src/taskmanager/index.js for TaskManager interface.

WorkforceMonitor monitors Docker worker containers and detects stuck workers.

src/monitor/index.js — full interface:

```javascript
export class WorkforceMonitor {
  /**
   * @param {Object} docker — DockerRunner instance (has listWorkers, logs, kill methods)
   * @param {Object} taskManager — TaskManager instance (has getTask, getSummary methods)
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=10000]
   * @param {number} [options.heartbeatTimeoutMs=60000]
   * @param {number} [options.timeoutMultiplier=2]
   */
  constructor(docker, taskManager, options = {}) {
    this.docker = docker;
    this.taskManager = taskManager;
    this.pollIntervalMs = options.pollIntervalMs ?? 10000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60000;
    this.timeoutMultiplier = options.timeoutMultiplier ?? 2;
    this._interval = null;
    this._lastCheck = null;
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this.check().catch(console.error), this.pollIntervalMs);
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  async check() {
    const containers = await this.docker.listWorkers();
    const healthy = [];
    const stuck = [];
    const killed = [];

    for (const container of containers) {
      // Parse task ID from container name: worker-<agent>-<taskId>
      const parts = container.name.split('-');
      const taskId = parts.slice(2).join('-');

      try {
        const task = await this.taskManager.getTask(taskId);
        const runningMs = Date.now() - new Date(container.created).getTime();
        const taskTimeout = (task.max_retries ?? 1) * 300000; // approximate

        if (runningMs > this.timeoutMultiplier * taskTimeout) {
          stuck.push(container);
          await this.docker.kill(container.name);
          killed.push(container.name);
          continue;
        }

        // Check heartbeat: if no recent log output
        const logs = await this.docker.logs(container.name, 1);
        if ((!logs.stdout && !logs.stderr) && runningMs > this.heartbeatTimeoutMs) {
          stuck.push(container);
          await this.docker.kill(container.name);
          killed.push(container.name);
          continue;
        }

        healthy.push(container);
      } catch {
        healthy.push(container); // unknown task — don't kill
      }
    }

    this._lastCheck = new Date().toISOString();
    return { healthy, stuck, killed };
  }

  async status() {
    return {
      containers: await this.docker.listWorkers(),
      summary: await this.taskManager.getSummary(),
      lastCheck: this._lastCheck,
    };
  }
}
```

For the TEST file (src/monitor/monitor.test.js):

Use node:test (describe, it) and node:assert/strict. Mock the DockerRunner — do NOT call real Docker.

Use node:test mock to create fake docker and taskManager objects:

```javascript
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

function makeMockDocker(containers = []) {
  return {
    listWorkers: mock.fn(async () => containers),
    logs: mock.fn(async () => ({ stdout: 'some output', stderr: '' })),
    kill: mock.fn(async () => true),
  };
}

function makeMockTaskManager(tasks = {}) {
  return {
    getTask: mock.fn(async (id) => {
      if (tasks[id]) return tasks[id];
      throw new Error(`Task ${id} not found`);
    }),
    getSummary: mock.fn(async () => ({ pending: 0, in_progress: 0, done: 0, failed: 0, total: 0 })),
  };
}
```

Test cases:
1. check() with no containers → returns { healthy: [], stuck: [], killed: [] }
2. check() with one healthy container → returns it in healthy array
3. check() with stuck container (running way past timeout) → kills it, returns in stuck+killed
4. status() returns containers + summary + lastCheck
5. start() creates an interval (verify _interval is not null after start)
6. stop() clears the interval (verify _interval is null after stop)
7. Container name parsing: 'worker-gemini-T1' extracts taskId 'T1'
8. Container name parsing: 'worker-claude-code-T2' extracts taskId 'T2' (agent name has a dash)

Wait — for test 8, the parsing is parts.slice(2).join('-'). For 'worker-claude-code-T2': parts = ['worker','claude','code','T2'], slice(2) = ['code','T2'], join = 'code-T2'. That's wrong. The correct taskId is 'T2'. This is a known limitation — note it but implement the parsing as specified above. The container naming convention uses worker-<agent>-<taskId> where agent is 'gemini' or 'claude-code', so 'worker-claude-code-T2' would be ambiguous. In practice, only Gemini workers are used (claude-code quota is 0), so this edge case doesn't matter right now.

Run npm test. All tests must pass with 0 failures.
Commit: git add -A && git commit -m "feat: add WorkforceMonitor module with tests"
```

**After completion**: `task_diff()` → verify only `src/monitor/index.js` and `src/monitor/monitor.test.js` were created. `task_accept()` → merge. `npm test` → expect ~102 tests, 0 failures.

---

## Task 3 of 5: P4 — Logger (`src/logger/index.js` + `src/logger/logger.test.js`)

**Dispatch this prompt via `orchestrate()`:**

```
This is a SINGLE task. Do NOT decompose into subtasks.

Create TWO files:
1. src/logger/index.js — Logger class + createLogger factory
2. src/logger/logger.test.js — unit tests

IMPORTANT: Logger output goes to stderr (process.stderr) by default — NEVER stdout. Stdout is the MCP JSON-RPC channel.

src/logger/index.js — full implementation:

```javascript
export class Logger {
  /**
   * @param {string} tag — e.g. 'orchestrator', 'mcp-server', 'gemini-T1'
   * @param {Object} [options]
   * @param {boolean} [options.quiet=false] — suppress all output (for tests)
   * @param {Object} [options.stream=process.stderr] — writable stream
   */
  constructor(tag, options = {}) {
    this.tag = tag;
    this.quiet = options.quiet ?? false;
    this.stream = options.stream ?? process.stderr;
    this._options = options;
  }

  info(message, ...args) { this._log('INFO', message, args); }
  warn(message, ...args) { this._log('WARN', message, args); }
  error(message, ...args) { this._log('ERROR', message, args); }

  debug(message, ...args) {
    if (!process.env.DEBUG) return;
    this._log('DEBUG', message, args);
  }

  child(subTag) {
    return new Logger(`${this.tag}:${subTag}`, this._options);
  }

  _log(level, message, args) {
    if (this.quiet) return;
    const ts = new Date().toISOString();
    const tag = `[${this.tag}]`;
    let line = `${ts} ${tag.padEnd(20)} ${level.padEnd(5)} ${message}`;
    if (args.length > 0) {
      const extra = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      line += ` ${extra}`;
    }
    this.stream.write(line + '\n');
  }
}

export function createLogger(tag, options) {
  return new Logger(tag, options);
}
```

Output format example:
```
2026-03-25T10:30:00.000Z [orchestrator]      INFO  Decomposing prompt into tasks
2026-03-25T10:30:01.000Z [orchestrator]      WARN  Timeout approaching
2026-03-25T10:30:02.000Z [gemini-T1]         ERROR Container exited with code 1
2026-03-25T10:30:03.000Z [orchestrator:T1]   DEBUG Worktree created
```

For the TEST file (src/logger/logger.test.js):

Use node:test and node:assert/strict. Capture output with a custom Writable stream:

```javascript
import { Writable } from 'node:stream';

function captureStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, enc, cb) { chunks.push(chunk.toString()); cb(); }
  });
  return { stream, chunks };
}
```

Test cases:
1. info() writes line containing tag, 'INFO', and message
2. warn() writes 'WARN' level
3. error() writes 'ERROR' level
4. debug() is suppressed when process.env.DEBUG is not set
5. debug() outputs when process.env.DEBUG is set (set it before test, restore after)
6. quiet mode: info/warn/error/debug produce no output
7. child('T1') creates logger with tag 'parent:T1'
8. child logger writes to same stream as parent
9. args are appended: info('hello', {a:1}) includes JSON.stringify({a:1})
10. createLogger() returns a Logger instance
11. output includes ISO timestamp (match regex /^\d{4}-\d{2}-\d{2}T/)
12. default stream is process.stderr (verify constructor default)

Run npm test. All tests must pass with 0 failures.
Commit: git add -A && git commit -m "feat: add structured Logger module with tests"
```

**After completion**: `task_diff()` → verify only `src/logger/index.js` and `src/logger/logger.test.js` were created. `task_accept()` → merge. `npm test` → expect ~114 tests, 0 failures.

---

## Task 4 of 5: P5 — E2E Test Plan (`tests/e2e/e2e-test-plan.md`)

**Dispatch this prompt via `orchestrate()`:**

```
This is a SINGLE task. Do NOT decompose into subtasks.

Create the file tests/e2e/e2e-test-plan.md — a comprehensive end-to-end test plan for the Multi-Agent Orchestrator MCP server.

This is a DOCUMENTATION task (type: docs). No code, no tests to run.

The orchestrator is an MCP server communicating over stdio using JSON-RPC 2.0. It exposes 8 tools:
1. orchestrate(prompt) — decompose → assign → execute in Docker workers
2. task_status(id?) — get task board or single task
3. task_diff(id) — git diff of completed task worktree
4. task_accept(id) — merge task branch to master
5. task_reject(id, reason) — re-queue with feedback
6. task_logs(id, tail?) — worker container stdout/stderr
7. task_kill(id) — force-stop worker
8. workforce_status() — running containers + summary

Write the test plan with these sections:

## Section 1: Prerequisites
- Docker daemon accessible (docker info)
- Worker images exist (worker-gemini:latest)
- MCP server starts (node src/mcp-server/index.js)
- Clean state: no stale .agent-team/tasks.db, no stale worktrees, no stale containers
- Git repo clean, on master

## Section 2: Smoke Tests (SMOKE-01 to SMOKE-07)
For each test: Name, Tool, JSON-RPC Input, Expected Response, Failure Criteria.

SMOKE-01: Initialize — send initialize + notifications/initialized → serverInfo.name === "multi-agent-orchestrator"
SMOKE-02: List tools — tools/list → exactly 8 tools with correct names
SMOKE-03: task_status empty board → total: 0, tasks: []
SMOKE-04: workforce_status no workers → containers: [], total: 0
SMOKE-05: task_status nonexistent ID → isError: true, "not found"
SMOKE-06: task_diff nonexistent ID → isError: true
SMOKE-07: task_kill nonexistent ID → isError: true or killed: false

## Section 3: Integration Tests (INT-01 to INT-05) — require Docker
INT-01: Full single-task pipeline — orchestrate → task_status → task_diff → task_accept
INT-02: Multi-task with dependency — 2 tasks, T2 depends on T1
INT-03: task_reject re-queues — reject a done task, verify status goes to pending
INT-04: task_kill stops running worker — start slow task, kill it, verify failed
INT-05: workforce_status during execution — shows running containers

## Section 4: Error Handling (ERR-01 to ERR-03)
ERR-01: orchestrate with empty prompt — should not crash
ERR-02: task_accept on pending task — should error
ERR-03: task_diff on in_progress task — partial diff or error

## Section 5: Regression Checklist
Bullet list of pre-flight checks before running E2E suite.

Commit: git add -A && git commit -m "docs: add E2E test plan"
```

**After completion**: `task_diff()` → verify only `tests/e2e/e2e-test-plan.md` was created. `task_accept()` → merge.

---

## Task 5 of 5: P5 — Smoke Test Script (`tests/e2e/smoke.mjs`)

**Dispatch this prompt via `orchestrate()`:**

```
This is a SINGLE task. Do NOT decompose into subtasks.

Create the file tests/e2e/smoke.mjs — a Node.js script that runs automated smoke tests against the MCP server.

The script uses child_process.spawn to start the MCP server and communicates via stdin/stdout JSON-RPC.

IMPORTANT: The MCP server entry point is: node src/mcp-server/index.js
IMPORTANT: Set env var PROJECT_ROOT to the project directory when spawning.
IMPORTANT: MCP server uses stdout for JSON-RPC responses and stderr for logs. Read stdout for responses, ignore stderr.

Full implementation:

```javascript
#!/usr/bin/env node
/**
 * E2E Smoke Tests — tests the MCP server directly via JSON-RPC over stdio.
 * Usage: node tests/e2e/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dir, '../..');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

let PASS = 0;
let FAIL = 0;
let nextId = 1;

function assert(testName, condition, got) {
  if (condition) {
    console.log(`${GREEN}PASS${NC} ${testName}`);
    PASS++;
  } else {
    console.log(`${RED}FAIL${NC} ${testName}`);
    console.log(`  Got: ${typeof got === 'string' ? got.slice(0, 200) : JSON.stringify(got)}`);
    FAIL++;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(' Orchestrator MCP Server — E2E Smoke Tests');
  console.log('═══════════════════════════════════════════════\n');

  // Start MCP server
  const server = spawn('node', [join(PROJECT_ROOT, 'src/mcp-server/index.js')], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
    stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
  });

  // Buffer stdout line-by-line (JSON-RPC responses are newline-delimited)
  let stdoutBuf = '';
  const responses = [];
  let resolveNext = null;

  server.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(parsed);
        } else {
          responses.push(parsed);
        }
      } catch {
        // not JSON — ignore
      }
    }
  });

  server.stderr.on('data', () => {}); // discard stderr

  function send(obj) {
    server.stdin.write(JSON.stringify(obj) + '\n');
  }

  function sendRequest(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for response to ${method}`)), 15000);
      const check = () => {
        const idx = responses.findIndex(r => r.id === id);
        if (idx !== -1) {
          clearTimeout(timeout);
          resolve(responses.splice(idx, 1)[0]);
          return;
        }
        resolveNext = (parsed) => {
          clearTimeout(timeout);
          if (parsed.id === id) {
            resolve(parsed);
          } else {
            responses.push(parsed);
            // Keep waiting — set up resolveNext again
            resolveNext = null;
            const poll = setInterval(() => {
              const idx2 = responses.findIndex(r => r.id === id);
              if (idx2 !== -1) {
                clearInterval(poll);
                resolve(responses.splice(idx2, 1)[0]);
              }
            }, 50);
            setTimeout(() => { clearInterval(poll); reject(new Error(`Timeout for ${method}`)); }, 14000);
          }
        };
      };
      // Check already-buffered responses first
      const idx = responses.findIndex(r => r.id === id);
      if (idx !== -1) {
        clearTimeout(timeout);
        resolve(responses.splice(idx, 1)[0]);
      } else {
        check();
      }
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  try {
    // Wait for server to start
    await new Promise(r => setTimeout(r, 2000));

    // ── SMOKE-01: Initialize ──
    const initResp = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    });
    assert('SMOKE-01: Initialize',
      initResp.result?.serverInfo?.name === 'multi-agent-orchestrator',
      initResp);

    // Send initialized notification (no id, no response)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await new Promise(r => setTimeout(r, 1000));

    // ── SMOKE-02: List tools ──
    const toolsResp = await sendRequest('tools/list');
    const toolNames = (toolsResp.result?.tools ?? []).map(t => t.name).sort();
    const expected = ['orchestrate','task_accept','task_diff','task_kill','task_logs','task_reject','task_status','workforce_status'].sort();
    assert('SMOKE-02a: tools/list returns 8 tools',
      toolNames.length === 8, toolNames);
    assert('SMOKE-02b: correct tool names',
      JSON.stringify(toolNames) === JSON.stringify(expected), toolNames);

    // ── SMOKE-03: task_status empty ──
    const statusResp = await sendRequest('tools/call', { name: 'task_status', arguments: {} });
    const statusText = statusResp.result?.content?.[0]?.text ?? '';
    assert('SMOKE-03: task_status empty board',
      statusText.includes('"total":') || statusText.includes('"total": '), statusText);

    // ── SMOKE-04: workforce_status empty ──
    const wfResp = await sendRequest('tools/call', { name: 'workforce_status', arguments: {} });
    assert('SMOKE-04: workforce_status valid response',
      wfResp.result?.content?.[0]?.text != null, wfResp);

    // ── SMOKE-05: task_status nonexistent ──
    const notFoundResp = await sendRequest('tools/call', { name: 'task_status', arguments: { id: 'TXXX' } });
    assert('SMOKE-05: task_status nonexistent → isError',
      notFoundResp.result?.isError === true || (notFoundResp.result?.content?.[0]?.text ?? '').includes('not found'),
      notFoundResp);

    // ── SMOKE-06: task_diff nonexistent ──
    const diffResp = await sendRequest('tools/call', { name: 'task_diff', arguments: { id: 'TXXX' } });
    assert('SMOKE-06: task_diff nonexistent → error',
      diffResp.result?.isError === true || (diffResp.result?.content?.[0]?.text ?? '').includes('error'),
      diffResp);

    // ── SMOKE-07: task_kill nonexistent ──
    const killResp = await sendRequest('tools/call', { name: 'task_kill', arguments: { id: 'TXXX' } });
    const killText = killResp.result?.content?.[0]?.text ?? '';
    assert('SMOKE-07: task_kill nonexistent → valid response',
      killText.includes('killed') || killText.includes('false') || killResp.result?.isError === true,
      killResp);

  } finally {
    server.kill();
    await new Promise(r => server.on('close', r));
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════');
  console.log(` Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}`);
  console.log('═══════════════════════════════════════════════');

  process.exit(FAIL);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

Commit: git add -A && git commit -m "test: add E2E smoke test script"
```

**After completion**: `task_diff()` → verify only `tests/e2e/smoke.mjs` was created. `task_accept()` → merge.

---

## Execution Sequence (Step by Step)

```
PHASE 0: Prerequisites
  └─ Run all verification checks listed above. Stop if any fail.

PHASE 1: P4 — TokenTracker Tests (Task 1)
  ├─ orchestrate(prompt_1)
  ├─ task_status() → wait for completion
  ├─ task_diff(T1) → review: only tracker.test.js created?
  ├─ task_accept(T1) → merge
  ├─ npm test → expect ~94 tests, 0 failures
  └─ If fail: task_reject(T1, reason), re-dispatch

PHASE 2: P4 — WorkforceMonitor (Task 2)
  ├─ orchestrate(prompt_2)
  ├─ task_status() → wait for completion
  ├─ task_diff(T1) → review: only monitor/index.js + monitor.test.js?
  ├─ task_accept(T1) → merge
  ├─ npm test → expect ~102 tests, 0 failures
  └─ If fail: task_reject, re-dispatch

PHASE 3: P4 — Logger (Task 3)
  ├─ orchestrate(prompt_3)
  ├─ task_status() → wait for completion
  ├─ task_diff(T1) → review: only logger/index.js + logger.test.js?
  ├─ task_accept(T1) → merge
  ├─ npm test → expect ~114 tests, 0 failures
  └─ If fail: task_reject, re-dispatch

PHASE 4: P5 — Test Plan (Task 4)
  ├─ orchestrate(prompt_4)
  ├─ task_diff(T1) → review: only tests/e2e/e2e-test-plan.md?
  ├─ task_accept(T1) → merge
  └─ No npm test needed (docs only)

PHASE 5: P5 — Smoke Script (Task 5)
  ├─ orchestrate(prompt_5)
  ├─ task_diff(T1) → review: only tests/e2e/smoke.mjs?
  ├─ task_accept(T1) → merge
  ├─ npm test → expect ~114 tests, 0 failures (smoke.mjs is not in test glob)
  └─ Optional: node tests/e2e/smoke.mjs → expect SMOKE-01 through SMOKE-07
```

---

## Acceptance Criteria — Full P4+P5

| # | Criterion | Verification |
|---|-----------|-------------|
| AC1 | `src/tracker/tracker.test.js` exists with >= 9 test cases | `npm test \| grep -c 'tracker'` |
| AC2 | `src/monitor/index.js` exports WorkforceMonitor class | `node -e "import('./src/monitor/index.js').then(m => console.log(typeof m.WorkforceMonitor))"` → `function` |
| AC3 | `src/monitor/monitor.test.js` exists with >= 6 test cases | `npm test \| grep -c 'monitor'` |
| AC4 | `src/logger/index.js` exports Logger and createLogger | `node -e "import('./src/logger/index.js').then(m => console.log(typeof m.Logger, typeof m.createLogger))"` → `function function` |
| AC5 | `src/logger/logger.test.js` exists with >= 10 test cases | `npm test \| grep -c 'logger'` |
| AC6 | `tests/e2e/e2e-test-plan.md` covers all 8 tools | `grep -c 'SMOKE-0' tests/e2e/e2e-test-plan.md` → 7 |
| AC7 | `tests/e2e/smoke.mjs` is executable Node.js | `node --check tests/e2e/smoke.mjs` → exits 0 |
| AC8 | `npm test` passes with **0 failures** and **>= 110 tests** | `npm test` output |
| AC9 | No existing source files modified | `git diff HEAD~5 --name-only \| grep -v test \| grep -v tests/ \| grep -v monitor \| grep -v logger \| grep -v tracker` → empty |
| AC10 | All 5 tasks merged to master | `git log --oneline -5` shows 5 merge commits |
| AC11 | All tasks executed by Gemini workers | Every `task_status()` shows `assigned_to: 'gemini'` |
| AC12 | Zero TASK_CONTEXT.md in any diff | `git log --oneline -5 --diff-filter=A -- TASK_CONTEXT.md` → empty |

## Definition of Done

**ALL of the following must be true simultaneously**:

1. `npm test` → `tests >= 110`, `fail 0`
2. `git status` → clean working tree
3. `git log --oneline -5` → shows 5 task merges (one per phase)
4. Six new files exist:
   - `src/tracker/tracker.test.js`
   - `src/monitor/index.js`
   - `src/monitor/monitor.test.js`
   - `src/logger/index.js`
   - `src/logger/logger.test.js`
   - `tests/e2e/e2e-test-plan.md`
   - `tests/e2e/smoke.mjs`
5. No existing source files were modified
6. Every merged task was executed by the `gemini` agent (check `assigned_to` field)

---

## Troubleshooting

**If `orchestrate()` splits the prompt into multiple subtasks despite "SINGLE task" instruction**:
- Clear DB: `rm -f .agent-team/tasks.db`
- Re-dispatch with even more explicit wording: add "You MUST create exactly 1 task with id T1" to the prompt

**If task completes but `task_diff()` shows TASK_CONTEXT.md**:
- The R1 fix from Prompt 1 should prevent this. If it still happens:
  ```bash
  git checkout --theirs TASK_CONTEXT.md && git add TASK_CONTEXT.md && git commit --no-edit
  rm TASK_CONTEXT.md && git add -A && git commit -m "cleanup: remove TASK_CONTEXT.md"
  ```

**If `task_accept()` has merge conflicts on other files**:
- Run `task_diff()` again to see what the worker changed
- If the worker modified files it shouldn't have, `task_reject()` with clear feedback about which files to touch

**If a worker creates files in wrong locations**:
- `task_reject()` with feedback: "Files must be at exact paths: src/monitor/index.js and src/monitor/monitor.test.js — no other files"

**If `npm test` fails after merge**:
- Read the failure output carefully
- If it's a test assertion failure, the worker wrote incorrect test logic — fix locally or re-dispatch
- If it's an import error, the worker used wrong import paths
