# Continuation Prompt — Multi-Agent Orchestrator

_Last updated: 2026-03-27_

---

## What This System Is

A **vendor-neutral AI workforce orchestrator**. Developers who pay for multiple AI
subscriptions (Claude Max, Gemini Advanced) use them as a coordinated team to complete
software engineering tasks in parallel. The Tech Lead (you, Claude Code) decomposes
work, dispatches it to Docker-isolated worker agents via MCP tools, reviews diffs,
and merges results.

The core value: token optimization + parallelism. Gemini (free tier, high quota) handles
bulk work. Claude handles precision tasks. Both run in containers, isolated, observable,
killable.

---

## Architecture (v4 — current)

```
Claude Code Chat (Tech Lead)
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
| Feature branch workflow | ✅ | CLAUDE.md documents mandatory protocol |
| Logger module | ✅ | src/logger/index.js — stderr only, DEBUG gate, child() |
| Stats module | ✅ | src/stats/index.js — summary/byAgent/avgDuration |
| Router v4 | ✅ | forced_agent priority, concurrency slot filtering |
| 122 unit + integration tests | ✅ | 0 failures |

---

## Known Issues / Not Yet Implemented

| Issue | Priority | Notes |
|-------|----------|-------|
| `reset-state` doesn't affect running MCP server | Medium | Script deletes the DB file but the server's open FD keeps old data in memory. Need a `task_reset` MCP tool, or restart the server after reset. |
| agents.json not hot-reloaded | Low | Changes to quota/capabilities require MCP server restart. Fix: re-read agents.json at start of each `orchestrate()` call. |
| WorkforceMonitor not wired into MCP | Low | `src/monitor/index.js` exists but `workforce_status` tool still returns docker ps output directly. Wire the monitor in. |
| Merger module not exercised | Low | `src/merger/` exists but task_accept uses a direct git merge call in tools.js. Evaluate if needed. |
| No PR flow | Medium | Tech Lead merges feature branches manually. Should automate: after all tasks done + tests pass → create PR. |
| Retry backoff not tested | Low | `retryDue()` exists in TaskManager but the orchestrator doesn't call it on a timer yet. |
| Gemini test authoring edge cases | Low | Gemini sometimes adds extra setup rows it doesn't count in assertions. Add SQLite precision note to AGENTS.md. |

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
task_logs(id, tail?)         — last N lines of container stdout/stderr
task_kill(id)                — force-stop a running container
workforce_status()           — all running containers + summary
```

---

## Suggested Next Steps (in order)

### 1. Implement `task_reset` MCP tool (30 min)
Add a `task_reset` tool to the MCP server that calls `taskManager.clear()` without
restarting the server. This fixes the `reset-state` → MCP server disconnect problem.

### 2. Hot-reload agents.json (20 min)
In `orchestrator/core.js`, move the `readFileSync(agentsPath)` call inside
`orchestrate()` so agent config is re-read on every job. Currently a restart is needed
to pick up quota/capability changes.

### 3. Wire retryDue() on a timer (30 min)
In `executeTasks()`, add a `setInterval(() => this.taskManager.retryDue(), 5000)`
that fires during the execution loop to move retry-queue tasks back to pending after
their backoff expires.

### 4. Wire WorkforceMonitor into workforce_status tool (45 min)
`src/monitor/index.js` already exists. Connect it so `workforce_status()` returns
heartbeat data, stuck-container alerts, and per-agent utilization, not just raw docker ps.

### 5. End-to-end test via MCP (1 session)
With all fixes in place, run a real multi-task job through the full MCP pipeline:
- Create feature branch
- Call `orchestrate()` with a non-trivial 3-task prompt
- Monitor with `task_status()` in real time
- Accept/reject based on diffs
- Merge feature branch to master
- Confirm 122+ tests pass

---

## Definition of Done (for this project)

- [ ] A 5-task job dispatched via `orchestrate()` completes with 0 manual interventions
- [ ] Gemini runs 3 containers in parallel (verify via `workforce_status()`)
- [ ] `forced_agent` routing confirmed: a task with `forced_agent: "gemini"` is never claimed by claude
- [ ] New `orchestrate()` call never picks up tasks from a prior job
- [ ] `npm test` shows 130+ tests, 0 failures (as new tests are added)
- [ ] No direct commits to master — all work flows through feature branches
- [ ] MCP server survives WSL2 reboot without manual intervention

---

## Key File Locations

```
src/mcp-server/index.js       — MCP server entry point + single-instance guard
src/mcp-server/tools.js       — MCP tool handlers
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
npm test                        # all 122 tests
node --test src/stats/stats.test.js    # stats module only
node tests/e2e/smoke.mjs        # MCP server smoke test (start server first)
```
