# v3 Execution Summary — Restart Prompt

You are continuing development of the **Multi-Agent Orchestrator v3** on branch `gemini-agent-fix`.
This document is your full context. Read it before touching any code.

---

## Key Reference Documents

| Document | Purpose |
|---|---|
| `DESIGN.md` | Full v3 architecture: MCP server + Docker workers + SQLite + token tracking |
| `PLAN.md` | Phased plan with task assignments (Claude tasks C1-C12, Gemini tasks G1-G10) |
| `RESEARCH_ANALYSIS.md` | Competitive landscape, v1/v2 post-mortem, technical findings |
| `agents.json` | Agent config: Docker images, capabilities, quota, token budgets |
| `CLAUDE.md` | Tech Lead instructions — MCP tool interface (updated to v3) |

Do NOT re-read `GEMINI_TECH_LEAD_PROMPT.md`, `Design-Gemini.md`, `Plan-Gemini.md` — superseded.

---

## What Was Built (Previous Session)

### Architecture pivot: v1 (subprocess) → v3 (MCP server + Docker containers)
Worker agents now run in Docker containers (real TTY, no stdin hacks) instead of raw Node.js subprocesses.
The orchestrator is an MCP server that any MCP client (Claude Code, Gemini CLI) can call.

### New files created
```
src/taskmanager/schema.sql          SQLite schema (replaces tasks.json)
src/taskmanager/index.js            REWRITTEN — SQLite via better-sqlite3 (was JSON+lockfile)
src/docker/runner.js                DockerRunner: spawn/monitor/kill worker containers
src/worktree/index.js               WorktreeManager: create/merge/diff/prune git worktrees
src/router/index.js                 AgentRouter: capability + quota routing
src/orchestrator/core.js            REWRITTEN — uses all new modules, no subprocess code
src/mcp-server/index.js             MCP server entry point (8 tools, stdio transport)
src/mcp-server/tools.js             Tool definitions + handlers
docker/workers/Dockerfile.gemini    @google/gemini-cli@0.34.0 + git (node:22-slim)
docker/workers/Dockerfile.claude    @anthropic-ai/claude-code@latest + git (node:22-slim)
docker/workers/validate-workers.sh  Build + smoke test script
docker/orchestrator/Dockerfile      Orchestrator MCP server image
docker/docker-compose.yml           Full stack definition
```

### Modified files
```
agents.json                         Updated with Docker image config + token budgets
CLAUDE.md                           Updated to v3 (MCP tools instead of CLI verbs)
package.json                        Updated scripts: start=mcp server, build:workers, validate
.claude/settings.local.json         MCP server registered (mcpServers.orchestrator)
```

### Verified working (end of previous session)
- `node src/mcp-server/index.js` starts cleanly on stdio
- `worker-gemini:latest` and `worker-claude:latest` Docker images built and verified
- Gemini worker in Docker: creates files, git available, auth mounts work
- MCP server registered in `.claude/settings.local.json` — reload Claude Code to activate
- `npm install` completed — `better-sqlite3` and `@modelcontextprotocol/sdk` installed

---

## Pending Work (in priority order)

### Priority 1 — Fix tests (BLOCKING: `npm test` = 76 failures, 0 passing)

All 76 tests were written for the v1 API. The v3 rewrite broke them.
Three categories of breakage:

**a) `src/taskmanager/taskmanager.test.js`** — expects v1 methods that no longer exist:
- `_withLock()` — removed (SQLite transactions replace it)
- `getTasksByAgent()` — removed (query SQLite directly instead)
- `resetStaleClaims()` used to return `string[]` of reset IDs — v3 returns `void`
- Fix: rewrite tests to use SQLite-based API; use `taskManager.db.prepare()` for setup/teardown

**b) `src/orchestrator/orchestrator.test.js`, `index.test.js`, `steps/steps.test.js`** — test v1 CLI step functions (`decompose.js`, `assign.js`, `execute.js`, etc.) that are now dead code.
- Fix: **delete** these 3 test files entirely

**c) `src/adapters/adapters.test.js`** — tests `ClaudeCodeAdapter`, `GeminiAdapter` from old `src/adapters/` which are now dead code.
- Fix: **delete** this test file

**Action — do in this order:**
1. Delete: `src/adapters/adapters.test.js`
2. Delete: `src/orchestrator/steps/steps.test.js`
3. Delete: `src/orchestrator/orchestrator.test.js`
4. Delete: `src/orchestrator/index.test.js`
5. Rewrite: `src/taskmanager/taskmanager.test.js` for v3 SQLite API
6. Run `npm test` — verify the kept tests pass: `merger.test.js`, `types.test.js`, `file-channel.test.js`

---

### Priority 2 — Delete dead code (after tests pass)

These files are v1 only. Nothing in v3 imports them. Safe to delete.

First verify with: `grep -r "from.*adapters/base\|from.*platform/detect\|from.*comms/file-channel" src/`
(must return nothing from v3 files before deleting)

```
src/adapters/base.js
src/adapters/claude-code.js
src/adapters/gemini.js
src/adapters/check.js
src/comms/channel.js
src/comms/file-channel.js
src/orchestrator/steps/assign.js
src/orchestrator/steps/decompose.js
src/orchestrator/steps/execute.js
src/orchestrator/steps/merge.js
src/orchestrator/steps/reset.js
src/orchestrator/steps/review.js
src/orchestrator/steps/status.js
src/orchestrator/session.js
platform/detect.js
platform/linux/   (directory)
platform/windows/ (directory)
```

Also delete superseded docs: `Design-Gemini.md`, `Plan-Gemini.md`, `GEMINI_TECH_LEAD_PROMPT.md`

---

### Priority 3 — Docker MCP Toolkit registration (enables Gemini CLI as Tech Lead)

The MCP server is registered for Claude Code (`.claude/settings.local.json`) but NOT yet in
Docker MCP Toolkit (which enables Gemini CLI to use it too).

Steps:
1. Ensure Docker Desktop is open and MCP Toolkit extension is active (Windows side)
2. Build orchestrator image: `docker compose -f docker/docker-compose.yml build orchestrator`
3. Register: `docker mcp server add orchestrator --image orchestrator:latest`
4. Connect clients: `docker mcp client connect claude-code` + `docker mcp client connect gemini`
5. Verify: `docker mcp server list` shows `orchestrator`

Note: `docker mcp client ls` returned "Docker Desktop is not running" during last session —
Docker daemon works from WSL but Docker Desktop MCP Toolkit UI must be open on Windows.

---

### Priority 4 — Phase 3 modules (design specifies, not yet created)

**`src/tracker/index.js`** — Token usage tracker (PLAN.md task C10)
- Parse Claude's `usage.input_tokens`, `total_cost_usd` from `--output-format json`
- Parse Gemini token counts from CLI output (format varies)
- Store per-task in SQLite `token_usage` column (schema already has the column)
- Aggregate by agent for routing decisions
- Currently: `core.js` partially handles this inline (extracts `token_usage` from Claude output)

**`src/monitor/index.js`** — Workforce health monitor (PLAN.md task G8)
- Poll `docker ps --filter name=worker-` every 10s
- Detect containers running > 2x their timeout (stuck)
- Heartbeat: if no new log output for 60s → `docker stop` + retry task
- Expose data to `workforce_status` MCP tool (currently returns raw `docker ps` output)

**`src/logger/index.js`** — Structured logger (PLAN.md task G9)
- Tagged output: `[orchestrator]`, `[gemini-T1]`, `[claude-T2]` + timestamps
- Replace `console.log`/`console.error` in `core.js` and `mcp-server/index.js`

---

### Priority 5 — E2E test via MCP (validates the full stack)

After tests pass and Docker MCP is registered:
1. Reload Claude Code (picks up MCP server from `.claude/settings.local.json`)
2. Verify `orchestrate` tool appears in Claude Code's tool list
3. Call: `orchestrate("add a JSDoc comment to the isAvailable method in src/worktree/index.js")`
4. Expected: Gemini worker spawns in Docker, completes, diff shows JSDoc added
5. Call `task_diff("T1")` — review the diff
6. Call `task_accept("T1")` — merge to main branch

---

## Architecture Summary

The orchestrator is a Node.js MCP server (`src/mcp-server/index.js`) that exposes 8 tools
to any MCP client (Claude Code or Gemini CLI). When `orchestrate(prompt)` is called, the
`Orchestrator` class (`src/orchestrator/core.js`) decomposes the prompt into tasks stored
in SQLite (`src/taskmanager/`), routes each task to an agent via `AgentRouter`, creates a
git worktree via `WorktreeManager`, and runs the agent in a Docker container via `DockerRunner`.
Workers are `worker-gemini:latest` and `worker-claude:latest` — both built and verified.
Auth credentials are volume-mounted read-only. Results are reviewed via `task_diff` and
merged via `task_accept`.

---

## Do Not Rework

- Do NOT rewrite `src/orchestrator/core.js` — it is complete and imports cleanly
- Do NOT rebuild Docker images — both are built and tagged locally
- Do NOT re-implement the MCP tools — all 8 are complete in `src/mcp-server/tools.js`
- Do NOT touch `src/merger/index.js` — unchanged from v1, still works, `core.js` imports it
- Do NOT change `agents.json` — already updated with Docker config

---

## Current Branch and Git State

```
Branch:  gemini-agent-fix
Last commit: d9ebf4d Fix Gemini adapter hangs and tool access issues (pre-v3)

All v3 work is UNCOMMITTED (staged/unstaged changes + untracked new files).
Commit after npm test passes with 0 failures.
```
