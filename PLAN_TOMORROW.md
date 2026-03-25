# Tech Lead Handover — Multi-Agent Orchestrator v3
**Date**: 2026-03-25 | **Branch**: master | **Tests**: 77 pass / 0 fail

---

## Role
You are the **Tech Lead** for this project. You orchestrate Gemini and Claude workers via MCP tools.
Read this file first. Then read `CLAUDE.md` for tool reference.

---

## What Is This System

A multi-agent orchestration system: you send a prompt via `orchestrate()`, it decomposes into
tasks, assigns them to Docker-isolated Gemini/Claude agents, executes in parallel git worktrees,
and you review via `task_diff()` and merge via `task_accept()`.

MCP tools (call natively):
- `orchestrate(prompt)` — full pipeline
- `task_status(id?)` — board or single task
- `task_diff(id)` — git diff of agent's work
- `task_accept(id)` — merge to master + prune
- `task_reject(id, reason)` — re-queue with feedback
- `task_logs(id)` — container stdout/stderr
- `task_kill(id)` — force-stop worker
- `workforce_status()` — all running containers

---

## What Was Completed (this session)

### Infrastructure — DONE ✓
- MCP server registered in `.mcp.json` and connected to Claude Code
- `master` branch has full v3 architecture (was `gemini-agent-fix`, now merged)
- 77 tests, 0 failures (`npm test`)

### Pipeline fixes — DONE ✓
- **Auto-commit**: orchestrator commits agent's uncommitted work after Docker exits
- **Base branch**: worktrees always branch from `master` (not current working branch)
- **Stale worktree cleanup**: `git checkout . && git clean -fd` before reuse
- **Clean diffs**: `task_diff` uses `master...branch` (not hardcoded `main`)
- **CLAUDE.md protection**: context file renamed to `TASK_CONTEXT.md` (not CLAUDE.md)

### Gemini worker fixes — DONE ✓
- **`pgrep` missing**: added `procps` to `docker/workers/Dockerfile.gemini`
- **Git inside container broken**: `.git` file points to host path invisible in container.
  Fixed by mounting `.git` as `/project-git` and setting `GIT_DIR`, `GIT_COMMON_DIR`,
  `GIT_WORK_TREE` env vars — git works without reading `.git` file at all
- **Git identity**: pre-baked `gemini-worker@localhost` in image (no prompt on commit)
- **Timeout**: raised from 120s → 300s (survives 429 backoff retries)
- **Dotfile context**: context file renamed `TASK_CONTEXT.md` (Gemini CLI's `read_file`
  ignores dotfiles — was `.task-context.md`, Gemini spent turns working around it)

### Proven working ✓
- Single-task Gemini run: `orchestrate → task_diff → task_accept` fully clean
- Gemini commits to its own branch, diff shows only its file, merges cleanly to master

---

## What Is NOT Done Yet

### 1. Multi-task parallel test — VERIFY FIRST TOMORROW
The 3-task parallel test was interrupted. The `TASK_CONTEXT.md` dotfile fix was the last
blocker. **First thing tomorrow**: reload MCP and re-run this test to confirm parallelism works.

Run this after clearing the DB:
```
orchestrate("Create three files in the project root, each as a separate task:

T1 (docs): Create CHANGELOG.md documenting the v3 refactor — list major changes:
MCP server, Docker workers, SQLite task manager, worktree isolation, agent router.

T2 (docs): Create CONTRIBUTING.md with contribution guidelines — sections for setup,
branching strategy (agent/* branches), running tests (npm test), and PR process.

T3 (code): Add a static validate(agents) method to src/router/index.js that checks
each agent has name, capabilities (non-empty array), and quota (0-100). Throw if invalid.")
```

Expected: T1+T2 → Gemini, T3 → claude-code. ~70:30 split.
After done: `task_diff` each, `task_accept` each.

### 2. P4 — Implement Phase 3 Modules
See `GEMINI_TASK_P4_PHASE3_MODULES.md` — still valid with ONE update:
- ~~Branch: `gemini-agent-fix`~~ → use **`master`** (already merged)

Three modules to build (source + tests):
- `src/tracker/index.js` — TokenTracker (parse Claude/Gemini token usage, store in SQLite)
- `src/monitor/index.js` — WorkforceMonitor (poll containers, kill stuck workers)
- `src/logger/index.js` — Logger (tagged structured logging to stderr)

**How to dispatch P4 via workforce** — use THREE separate `orchestrate()` calls (one per module).
Do NOT use a single call for all three: the planner will compress the interface specs and workers
will invent their own APIs. Each call must include the full interface inline. Example:

```
orchestrate("Implement src/tracker/index.js — TokenTracker class for the v3 orchestrator.
Read src/taskmanager/index.js and src/taskmanager/schema.sql first (token_usage column exists).
Interface (all methods async):
  constructor(taskManager)
  parseClaude(stdout) → { input, output, cache_read, cost_usd } | null  [parse Claude JSON output]
  parseGemini(stdout, prompt) → { input_est, output_est, cost_usd:0 }   [estimate: chars/4]
  record(taskId, usage) → direct SQL: UPDATE tasks SET token_usage=? WHERE id=?
  summaryByAgent() → query tasks, aggregate by assigned_to
  totalCost() → { totalCost, taskCount }
Also create src/tracker/tracker.test.js using node:test (NOT jest).
Run npm test — all tests must pass 0 failures.")
```

Repeat for WorkforceMonitor and Logger using the full specs in `GEMINI_TASK_P4_PHASE3_MODULES.md`.
Each module lands in its own directory (no merge conflicts between parallel tasks).
Expected total after P4: ~97 tests passing.

### 3. P5 — E2E Smoke Tests
See `GEMINI_TASK_P5_E2E_TEST.md` — still valid with TWO updates:
- ~~Branch: `gemini-agent-fix`~~ → use **`master`**
- ~~`GEMINI.md or CLAUDE.md`~~ → context file is now **`TASK_CONTEXT.md`**

Deliverables:
- `tests/e2e/e2e-test-plan.md` — test plan for all 8 MCP tools
- `tests/e2e/smoke.sh` (or `smoke.mjs`) — automated smoke test via JSON-RPC over stdio

**How to dispatch P5 via workforce** — single `orchestrate()` call is fine:
the two files are docs/scripts with no interface precision requirements.

```
orchestrate("Create two files for E2E testing the orchestrator MCP server:
1. tests/e2e/e2e-test-plan.md — test plan covering all 8 MCP tools (orchestrate, task_status,
   task_diff, task_accept, task_reject, task_logs, task_kill, workforce_status). Include:
   prerequisites, smoke tests (SMOKE-01 to SMOKE-07), integration tests (INT-01 to INT-05),
   error handling tests, and a regression checklist.
2. tests/e2e/smoke.mjs — Node.js smoke test script using child_process.spawn to communicate
   with the MCP server over stdio JSON-RPC. Test initialize handshake, tools/list (8 tools),
   task_status empty board, workforce_status, and error cases for nonexistent task IDs.
   Print PASS/FAIL per test. Exit code = number of failures.")
```

---

## Known Remaining Risks

| Risk | Severity | Status |
|------|----------|--------|
| Gemini 429 rate limiting | Medium | Handled by 300s timeout + CLI backoff. Transient. |
| claude-code worker GIT_DIR fix untested standalone | Low | The runner.js fix applies to all agents but claude-code hasn't been tested in isolation since the fix. Should work — same code path. |
| Multi-task parallel worktree race condition | Unknown | Not yet tested. First task tomorrow. |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/orchestrator/core.js` | Main orchestration logic, `_autoCommit`, task routing |
| `src/docker/runner.js` | Docker container lifecycle, GIT_DIR env vars |
| `src/worktree/index.js` | Git worktree lifecycle, base branch detection |
| `src/mcp-server/index.js` | MCP server entry point |
| `src/mcp-server/tools.js` | 8 MCP tool implementations |
| `src/taskmanager/index.js` | SQLite state machine |
| `docker/workers/Dockerfile.gemini` | Gemini worker image (procps, git identity) |
| `docker/workers/config/gemini-settings.json` | Clean settings (no host MCP configs) |
| `agents.json` | Agent capabilities + quota (gemini 70, claude 30) |

---

## Start-of-Session Checklist

```bash
# 1. Confirm clean state
git status && git log --oneline -3
npm test

# 2. Clear any stale task DB
node --input-type=module -e "
import { TaskManager } from './src/taskmanager/index.js';
const tm = new TaskManager('.agent-team');
await tm.initialize(); tm.clear(); console.log('cleared');
"

# 3. Confirm worker images exist
docker images | grep worker-

# 4. Reload MCP (in Claude Code): /mcp
```

---

## Worker Agent Instructions

When assigning tasks to Gemini/Claude workers via `orchestrate()`, the system automatically:
- Creates an isolated git branch `agent/<agent>/<taskId>` from `master`
- Writes task instructions to `TASK_CONTEXT.md` in the worktree
- Mounts `.git` as `/project-git` with correct env vars so git works in Docker
- Auto-commits any uncommitted changes after the container exits
- Cleans stale files from reused worktrees

You do NOT need to manage any of this — just call `orchestrate()` and review results.
