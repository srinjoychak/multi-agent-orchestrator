# Development Plan — Multi-Agent Orchestrator v3

**Status:** Planning — awaiting approval
**Last Updated:** 2026-03-24
**Platform:** WSL2 (Ubuntu) on Windows 11
**Runtime:** Docker MCP Toolkit

---

## Context

This project orchestrates multiple AI coding CLIs (Claude Code, Gemini CLI) as a parallel
workforce. v1 and v2 failed on subprocess management (TTY/stdin/pipe issues). v3 replaces
subprocess spawning with Docker containers, eliminating all TTY problems at the infrastructure
level. The orchestrator itself is an MCP server hosted in Docker MCP Toolkit.

**Core priorities (in order):**
1. Token usage optimization
2. MCP-native interface (works from Claude OR Gemini as Tech Lead)
3. Docker-isolated worker execution
4. Cross-vendor agent support
5. Observable, killable workforce

See DESIGN.md v3 for full architecture. See RESEARCH_ANALYSIS.md for v1/v2 post-mortem.

---

## Verified Prerequisites

| Item | Status | Command / Evidence |
|---|---|---|
| WSL2 | OK | Linux 6.6.87.2-microsoft-standard-WSL2 |
| Docker from WSL | OK | `docker run --rm hello-world` succeeds |
| Docker MCP Toolkit | OK | `docker mcp server list` works |
| Docker MCP clients | OK | Supports: claude-code, gemini (via `docker mcp client connect`) |
| Gemini CLI (host) | OK | v0.34.0, `@google/gemini-cli`, OAuth personal auth |
| Claude Code (host) | OK | v2.1.81, OAuth auth (Claude Max subscription) |
| Gemini headless | OK | `gemini -p "..." -y < /dev/null` completes in seconds |
| Claude headless | OK | `claude --print -p "..." --output-format json` returns structured JSON |
| Node.js | OK | v24.14.0 |
| Git worktrees | OK | Tested in v1/v2, working |
| Docker socket | OK | Accessible from WSL containers |

**Blocker found:** Gemini official sandbox Docker image is v0.1.1 (stale, doesn't support
current OAuth). Must build custom `worker-gemini` image with `@google/gemini-cli@0.34.0`.

**WSL migration note:** All Windows-specific code (`cmd.exe /c` routing, `taskkill /F /T`,
ConPTY handling) in `platform/detect.js` is now dead code. Linux-native equivalents are
simpler. Docker containers are Linux-native — no platform abstraction needed.

---

## Phase 0 — Docker Worker Images (Foundation)

**Goal:** Both CLI agents run reliably in Docker containers with auth + worktree mounts.
**Assigned to:** Gemini (research + Dockerfile authoring)
**Parallel work:** Claude works on Phase 1 simultaneously.

### 0.1 — Dockerfile.gemini
**New file:** `docker/workers/Dockerfile.gemini`

```dockerfile
FROM node:22-slim
RUN npm install -g @google/gemini-cli@0.34.0
RUN mkdir -p /work /home/node/.gemini && chown -R node:node /home/node /work
USER node
WORKDIR /work
ENTRYPOINT ["gemini"]
```

Auth: mount `~/.gemini` → `/home/node/.gemini` (rw — Gemini writes user_id, state).
Prompt: pass via `-p "..." -y` flags.

### 0.2 — Dockerfile.claude
**New file:** `docker/workers/Dockerfile.claude`

```dockerfile
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code@latest
RUN mkdir -p /work /home/node/.claude && chown -R node:node /home/node /work
USER node
WORKDIR /work
ENTRYPOINT ["claude"]
```

Auth: mount `~/.claude` → `/home/node/.claude` (ro).
Prompt: pass via `--print -p "..." --output-format json --dangerously-skip-permissions`.

### 0.3 — Build and test both images
```bash
docker build -t worker-gemini -f docker/workers/Dockerfile.gemini .
docker build -t worker-claude -f docker/workers/Dockerfile.claude .

# Test Gemini
docker run --rm -t \
  -v ~/.gemini:/home/node/.gemini \
  -v /tmp/test-worktree:/work \
  worker-gemini -p "respond with HELLO" -y

# Test Claude
docker run --rm -t \
  -v ~/.claude:/home/node/.claude \
  -v /tmp/test-worktree:/work \
  worker-claude --print -p "respond with HELLO" --output-format json
```

**Pass criteria:** Both containers complete in < 30s, produce expected output, exit cleanly.

### 0.4 — Parallel execution test
Create 2 worktrees, run Gemini + Claude simultaneously on separate tasks.
Verify: no file conflicts, both complete, both produce valid output.

---

## Phase 1 — Core Engine (SQLite + Docker Runner + Worktree Manager)

**Goal:** The orchestration engine can manage tasks, spawn Docker workers, and track results.
**Assigned to:** Claude (code architecture + implementation)
**Parallel with:** Phase 0.

### 1.1 — SQLite Task Manager
**File:** `src/taskmanager/index.js` (rewrite storage layer)
**New file:** `src/taskmanager/schema.sql`

- Replace JSON file + `proper-lockfile` with `better-sqlite3`
- Keep existing state machine logic (pending → claimed → in_progress → done/failed)
- Add columns: `container_id`, `token_usage`, `created_at`
- Add `npm install better-sqlite3` to package.json
- Migrate existing tests to work with SQLite

### 1.2 — Docker Runner
**New file:** `src/docker/runner.js`

```js
class DockerRunner {
  async run(taskId, agentName, worktreePath, prompt, options) { ... }
  async logs(containerId, tail) { ... }
  async kill(containerId) { ... }
  async inspect(containerId) { ... }
  async listWorkers() { ... }
}
```

- Spawns worker containers via `child_process.spawn('docker', ['run', ...])`
- Captures stdout/stderr via `docker logs`
- Enforces timeout via `--stop-timeout` + fallback `docker kill`
- Returns structured result: `{ exitCode, stdout, stderr, duration_ms, containerId }`

### 1.3 — Worktree Manager (extract from core.js)
**New file:** `src/worktree/index.js`

- Extract `_createWorktree()` from `src/orchestrator/core.js`
- Add: `merge()`, `diff()`, `prune()`, `reset()`
- All git operations via `child_process.execFile('git', ...)`
- No platform abstraction needed — Linux only

### 1.4 — Agent Router (extract from core.js)
**New file:** `src/router/index.js`

- Extract `assignTasks()` logic from core.js
- Add token budget awareness: deprioritize agents over budget
- Configurable via `agents.json`

### 1.5 — Orchestrator Core (refactor)
**File:** `src/orchestrator/core.js` (refactor, not rewrite)

- Replace direct subprocess calls with `DockerRunner`
- Replace `TaskManager` file I/O with SQLite
- Replace inline worktree logic with `WorktreeManager`
- Replace inline routing with `AgentRouter`
- Keep: `decomposeTasks()` prompt, `_extractJsonArray()`, `executeTasks()` wave logic

---

## Phase 2 — MCP Server

**Goal:** Orchestrator exposed as MCP tools, registered in Docker MCP Toolkit.
**Assigned to:** Claude (MCP SDK experience)
**Depends on:** Phase 0 + Phase 1 complete.

### 2.1 — MCP Server Scaffold
**New file:** `src/mcp-server/index.js`

- Use `@modelcontextprotocol/sdk` (npm package)
- Stdio transport (standard for Docker MCP Toolkit)
- Instantiate `Orchestrator`, `DockerRunner`, `TaskManager` on startup

### 2.2 — Tool Implementations
**New file:** `src/mcp-server/tools.js`

| Tool | Handler | Notes |
|---|---|---|
| `orchestrate` | `core.run(prompt)` | Full pipeline: decompose → assign → execute |
| `task_status` | `taskManager.getStatus(id?)` | Board view or single task |
| `task_diff` | `worktreeManager.diff(taskId)` | Returns git diff string |
| `task_accept` | `merger.merge(taskId)` | Merge + prune worktree |
| `task_reject` | `taskManager.reject(taskId, reason)` | Re-queue to pending |
| `task_logs` | `dockerRunner.logs(containerId, tail)` | Last N lines |
| `task_kill` | `dockerRunner.kill(containerId)` | Force stop |
| `workforce_status` | `dockerRunner.listWorkers()` | Active containers |

### 2.3 — Orchestrator Docker Image
**New file:** `docker/orchestrator/Dockerfile`

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y git docker.io && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install
COPY src/ src/
COPY agents.json .
ENTRYPOINT ["node", "src/mcp-server/index.js"]
```

### 2.4 — Docker Compose Stack
**New file:** `docker/docker-compose.yml`

Defines the orchestrator service with Docker socket mount, project volume, auth mounts.

### 2.5 — Register with Docker MCP Toolkit
```bash
docker mcp server add orchestrator --image orchestrator:latest
docker mcp client connect claude-code
docker mcp client connect gemini
```

### 2.6 — E2E Test
From Claude Code chat:
1. Call `orchestrate("add JSDoc comments to src/taskmanager/index.js")`
2. Verify: Gemini worker spawned in Docker, completes, produces diff
3. Call `task_diff(T1)` — review the diff
4. Call `task_accept(T1)` — merge to main

From Gemini CLI chat:
1. Same flow — verify identical behavior

---

## Phase 3 — Monitoring, Reliability, Token Optimization

**Goal:** Production-grade workforce management.
**Assigned to:** Split between Claude and Gemini.

### 3.1 — Workforce Monitor (Gemini)
**New file:** `src/monitor/index.js`
- Poll `docker ps` for worker containers every 10s
- Detect stuck containers (running > 2x timeout)
- Heartbeat: if `docker logs` shows no new output for 60s → kill + retry
- Expose via `workforce_status` MCP tool

### 3.2 — Token Tracker (Claude)
**New file:** `src/tracker/index.js`
- Parse token usage from Claude JSON output (`usage.input_tokens`, `total_cost_usd`)
- Parse Gemini token counts from CLI output
- Store per-task in SQLite `token_usage` column
- Aggregate reporting: total tokens, cost per agent, cost per task type

### 3.3 — Retry Logic (Claude)
- Failed tasks re-queued to a different agent (respects `previous_agents`)
- Max 3 retries (configurable in `agents.json`)
- Exponential backoff between retries

### 3.4 — Structured Logging (Gemini)
- Replace `console.log` with tagged logger: `[orchestrator]`, `[gemini-T1]`, `[claude-T2]`
- Timestamps on all lines
- Log to file + stdout

### 3.5 — Tests (Split)
- Unit tests for DockerRunner, TaskManager-SQLite, Router, Monitor (Claude)
- Integration tests: full E2E with real Docker containers (Gemini)

---

## Phase 4 — Extend (Future)

- [ ] 4.1 — Codex CLI adapter + Docker image
- [ ] 4.2 — Aider adapter + Docker image
- [ ] 4.3 — Swarm mode (multiple agents, same task, best result wins)
- [ ] 4.4 — Web dashboard (Express + SSE, served from orchestrator container)
- [ ] 4.5 — Prompt caching optimization (Claude ephemeral cache + Gemini context cache)
- [ ] 4.6 — Multi-project support (switch PROJECT_ROOT dynamically)

---

## Development Task Assignments

### Parallel Development Strategy

Claude and Gemini work simultaneously on non-overlapping tasks. File ownership
prevents merge conflicts. Each task produces a testable deliverable.

```
Timeline:
  Phase 0 (Gemini) ─────────┐
  Phase 1 (Claude) ─────────┤─── Phase 2 (Claude) ──── Phase 3 (Split)
                             │
                     Integration test
```

### Claude Sonnet — Task List

Claude handles core architecture, MCP server, and precision code work.

| ID | Phase | Task | Files (owned) | Depends On | Deliverable |
|---|---|---|---|---|---|
| C1 | 1.1 | SQLite Task Manager | `src/taskmanager/index.js`, `src/taskmanager/schema.sql` | — | `npm test` passes, tasks CRUD works |
| C2 | 1.2 | Docker Runner | `src/docker/runner.js` | — | Can spawn/kill/log Docker containers |
| C3 | 1.3 | Worktree Manager | `src/worktree/index.js` | — | Create/merge/diff/prune worktrees |
| C4 | 1.4 | Agent Router | `src/router/index.js` | C1 | Routes tasks by capability + quota |
| C5 | 1.5 | Refactor Orchestrator Core | `src/orchestrator/core.js` | C1,C2,C3,C4 | Core uses new modules, tests pass |
| C6 | 2.1 | MCP Server Scaffold | `src/mcp-server/index.js` | C5 | MCP server starts, lists tools |
| C7 | 2.2 | MCP Tool Implementations | `src/mcp-server/tools.js` | C6 | All 8 tools callable |
| C8 | 2.3 | Orchestrator Dockerfile | `docker/orchestrator/Dockerfile` | C7 | Image builds, server runs |
| C9 | 2.4 | Docker Compose | `docker/docker-compose.yml` | C8 | `docker compose up` works |
| C10 | 3.2 | Token Tracker | `src/tracker/index.js` | C5 | Token usage stored per task |
| C11 | 3.3 | Retry Logic | `src/orchestrator/core.js` (enhance) | C5 | Failed tasks re-queued correctly |
| C12 | 3.5a | Unit Tests | `tests/unit/*.test.js` | C5 | All new modules have tests |

### Gemini — Task List

Gemini handles Docker images, monitoring, research, and integration testing.

| ID | Phase | Task | Files (owned) | Depends On | Deliverable |
|---|---|---|---|---|---|
| G1 | 0.1 | Dockerfile.gemini | `docker/workers/Dockerfile.gemini` | — | Image builds, `gemini --version` works |
| G2 | 0.2 | Dockerfile.claude | `docker/workers/Dockerfile.claude` | — | Image builds, `claude --version` works |
| G3 | 0.3 | Docker worker validation | (test scripts) | G1,G2 | Both workers complete test prompts |
| G4 | 0.4 | Parallel execution test | (test scripts) | G3 | 2 workers run simultaneously, no conflicts |
| G5 | 2.5 | Docker MCP registration | (config) | C9 | `docker mcp server add` succeeds |
| G6 | 2.6 | E2E test (Claude as TL) | `tests/integration/e2e.test.js` | C9,G5 | Full pipeline from Claude Code chat |
| G7 | 2.6 | E2E test (Gemini as TL) | `tests/integration/e2e-gemini.test.js` | C9,G5 | Full pipeline from Gemini CLI chat |
| G8 | 3.1 | Workforce Monitor | `src/monitor/index.js` | C2 | Stuck containers detected + killed |
| G9 | 3.4 | Structured Logging | `src/logger/index.js` | — | Tagged, timestamped log output |
| G10 | 3.5b | Integration Tests | `tests/integration/*.test.js` | C9,G5 | E2E with real Docker containers |

### Conflict Prevention Rules

1. **File ownership is exclusive.** Each file has exactly one owner (Claude or Gemini).
2. **Shared files** (`package.json`, `agents.json`, `CLAUDE.md`) are edited only by Claude.
3. **Gemini does not touch `src/` except** its owned files (`src/monitor/`, `src/logger/`).
4. **Integration points** are defined by interfaces (function signatures), not implementations.
5. **All work in git worktrees** — merge to main only after review.

---

## What to Keep / Scrap from Current Codebase

### Keep (adapt)
| File | Reuse |
|---|---|
| `src/orchestrator/core.js` | Decomposition prompt, wave execution logic, JSON extraction |
| `src/taskmanager/index.js` | State machine logic (rewrite storage to SQLite) |
| `src/merger/index.js` | Git merge logic |
| `src/types/index.js` | Type definitions |
| `src/adapters/claude-code.js` | `parseOutput()` and `buildArgs()` logic → move to DockerRunner |
| `src/adapters/gemini.js` | `parseOutput()` logic → move to DockerRunner |
| Test files | Adapt to new interfaces |

### Scrap
| File | Reason |
|---|---|
| `platform/detect.js` | Windows-only. Docker replaces subprocess management entirely. |
| `src/adapters/base.js` | Subprocess spawning logic replaced by DockerRunner. |
| `src/comms/file-channel.js` | Replaced by SQLite. |
| `src/comms/channel.js` | Replaced by SQLite. |
| `src/orchestrator/steps/*.js` | CLI verb handlers. MCP tools replace them. |
| `src/orchestrator/session.js` | Session management for CLI mode. Not needed with MCP. |

### Delete (cleanup)
| File | Reason |
|---|---|
| `Design-Gemini.md` | Incorporated into DESIGN.md v3. |
| `Plan-Gemini.md` | Incorporated into PLAN.md v3. |
| `GEMINI_TECH_LEAD_PROMPT.md` | Already deleted (git status shows D). |

---

## Immediate Next Step

**Awaiting user approval to begin execution.**

Once approved:
1. Claude starts C1 + C2 + C3 in parallel (SQLite TaskManager, DockerRunner, WorktreeManager)
2. Gemini starts G1 + G2 in parallel (Docker worker images)
3. Both converge at integration test after Phase 1 + Phase 0 complete
