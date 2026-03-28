# Continuation Prompt — Multi-Agent Orchestrator

_Last updated: 2026-03-28_

---

## Execution Plan (2026-03-28) — Gemini CLI (Tech Lead)

I have completed the fixes for the v1 readiness gaps identified in the current state.

### Completed Objectives:
1.  **Isolation & Correctness:** Fixed `GEMINI.md` leakage and corrected the `--approval-mode yolo` flag. [DONE]
2.  **Planner Intelligence:** Injected project context (ESM, file structure) into the decomposition step. [DONE]
3.  **Lifecycle Robustness:** Implemented `task_discard`, ensured `task_kill` and permanent failures prune worktrees, and wired up `retryDue`. [DONE]
4.  **Operational Flexibility:** Enabled hot-reloading of `agents.json` and updated `reset-state` to prune host-side planner sessions. [DONE]

### Verification Summary:
-   **Unit Tests:** Added `tests/unit/gaps.test.js` covering `task_discard`, `killTask` pruning, `retryDue` integration, failed task sweep, and `agents.json` hot-reload.
-   **Baseline:** All 94 tests passing (`npm test`).

---

## What This System Is

A **vendor-neutral AI workforce orchestrator**. Developers who pay for multiple AI
subscriptions (Claude Max, Gemini Advanced) use them as a coordinated team to complete
software engineering tasks in parallel. The Tech Lead (you, Claude Code or Gemini CLI)
decomposes work, dispatches it to Docker-isolated worker agents via MCP tools, reviews
diffs, and merges results.

The core value: token optimization + parallelism. Gemini (free tier, high quota) handles
bulk work. Claude handles precision tasks. Both run in containers, isolated, observable,
killable.

---

## Architecture (v4 — current)

```
Claude Code Chat / Gemini CLI (Tech Lead)
        │ MCP tools over stdio
        ▼
Orchestrator MCP Server  (node src/mcp-server/index.js)
        │
        ├── TaskManager (SQLite — ~/.local/share/multi-agent-orchestrator-v3/tasks.db)
        │     jobs table + tasks table, job-UUID scoped, forced_agent, retry queue
        ├── AgentRouter  (quota + concurrency + forced_agent)
        ├── WorktreeManager  (git worktree per task, forks from Tech Lead's current branch)
        ├── DockerRunner  (spawn/kill containers, job-scoped container names)
        └── TokenTracker / WorkforceMonitor / TaskStats / Logger
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
  New calls never pick up stale tasks from old jobs.
- Workers fork from the Tech Lead's current branch (not hardcoded master).

---

## What Is Working

| Component | Status | Notes |
|-----------|--------|-------|
| MCP server (single-instance) | ✅ | PID file guard, SIGTERM/SIGINT handlers |
| SQLite on ext4 | ✅ | DELETE journal mode, WAL cleanup on startup |
| Gemini worker (Docker) | ✅ | --approval-mode yolo, --output-format json, mcpServers:{} |
| Job UUID scoping | ✅ | orchestrate() creates UUID, execution loop is job-scoped |
| forced_agent field | ✅ | Router respects it, claimTask() enforces it |
| Concurrency (3x gemini) | ✅ | _runningCounts map in orchestrator, concurrency field in agents.json |
| Worktree branching | ✅ | Workers fork from Tech Lead's current branch |
| Feature branch workflow | ✅ | CLAUDE.md / GEMINI.md document mandatory protocol |
| Logger module | ✅ | src/logger/index.js — stderr only, DEBUG gate, child() |
| Stats module | ✅ | src/stats/index.js — summary/byAgent/avgDuration |
| Router v4 | ✅ | forced_agent priority, concurrency slot filtering |
| 94 unit + integration tests | ✅ | 0 failures |
| GEMINI.md isolation | ✅ | Overwritten in worktree during run, reset after |
| task_discard tool | ✅ | Permanently closes task, prunes worktree |
| agents.json hot-reload | ✅ | Re-read at start of each orchestrate() call |

---

## Branching Protocol (MANDATORY — do not skip)

```bash
# START of every session:
git checkout master && git pull
git checkout -b feat/<short-description>

# AFTER all tasks accepted and npm test passes:
git checkout master
git merge --no-ff feat/<short-description> -m "feat: <description>"
```

Workers automatically fork from your current branch. `task_accept(id)` merges
the worker branch into your feature branch. Only you merge to master.

---

## MCP Tools Quick Reference

```
orchestrate(prompt)          — decompose + assign + execute full pipeline
task_status(id?)             — live board (all tasks) or single task detail
task_diff(id)                — git diff of completed worktree vs base
task_accept(id)              — merge worker branch into current HEAD
task_reject(id, reason)      — re-queue with rejection appended to description
task_discard(id)             — permanently close task, no re-queue
task_logs(id, tail?)         — last N lines of container stdout/stderr
task_kill(id)                — force-stop a running container + prune
workforce_status()           — all running containers + summary
task_reset()                 — hard reset (clear DB, all worktrees)
```

---

## Suggested Next Steps (in order)

### 1. WorkforceMonitor wiring (45 min)
`src/monitor/index.js` already exists. Connect it so `workforce_status()` returns
heartbeat data, stuck-container alerts, and per-agent utilization, not just raw docker ps.

### 2. Merger module evaluation (30 min)
`src/merger/` exists but `task_accept` uses a direct git merge call. Evaluate if a specialized merger is needed for complex conflicts.

### 3. Automated PR flow (60 min)
Tech Lead merges feature branches manually. Automate: after all tasks done + tests pass → create/submit PR.

### 4. Definition of Done verification
Run a 5-task parallel job to confirm absolute zero-intervention completion.

---

## Key File Locations

```
src/mcp-server/index.js       — MCP server entry point + single-instance guard
src/mcp-server/tools.js       — MCP tool handlers (task_discard added here)
src/orchestrator/core.js      — orchestrate(), executeTasks(), decomposeTasks()
src/taskmanager/index.js      — SQLite state machine, job scoping, forced_agent
src/taskmanager/schema.sql    — jobs + tasks schema
src/router/index.js           — agent selection (forced_agent → concurrency → quota)
src/worktree/index.js         — git worktree lifecycle
src/docker/runner.js          — container spawn/kill/logs
src/stats/index.js            — task statistics (summary/byAgent/avgDuration)
src/logger/index.js           — structured logger (stderr, DEBUG gate, child())
agents.json                   — agent capabilities, quota, concurrency
DESIGN.md                     — full architecture documentation
CLAUDE.md                     — Tech Lead operating instructions
AGENTS.md                     — agent prompt structure specification
```

---

## How to Start the MCP Server

```bash
# Ensure only one instance:
npm run kill-mcp 2>/dev/null; sleep 1
node src/mcp-server/index.js &

# Or let Claude Code start it via .claude/settings.local.json registration
```

## How to Run Tests

```bash
npm test                        # all 94 tests
node --test tests/unit/gaps.test.js    # new gap tests only
```
