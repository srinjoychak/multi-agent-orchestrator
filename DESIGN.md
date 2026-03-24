# Multi-Agent Orchestrator — Design Document v3
_Last updated: 2026-03-24_

---

## Vision

A vendor-neutral orchestration layer that coordinates heterogeneous AI coding agents
(Claude Code, Gemini CLI, Codex, and future agents) working as a **team** on software
engineering tasks. The system is **MCP-native**, runs workers in **Docker containers**
for isolation and TTY reliability, uses **git worktrees** for zero-conflict parallelism,
and is operable from **any MCP-capable chat interface** (Claude Code, Gemini CLI, etc.).

### Core Value Proposition

Developers who pay for multiple AI subscriptions (Claude Max, Gemini Advanced, GitHub
Copilot) can use them as a coordinated workforce — routing work by capability, balancing
quota, **optimizing token usage**, and reviewing results — at zero marginal cost.

### Guiding Principles

1. **Token optimization above all.** Every design decision must minimize wasted tokens.
   Small, focused prompts. Minimal context files. Route commodity tasks to free-tier agents.
2. **MCP-native.** The orchestrator is an MCP server. Any MCP client can be the Tech Lead.
3. **Docker-isolated.** Workers run in containers. No subprocess TTY/stdin hacks.
4. **Cross-vendor.** Claude, Gemini, Codex — same interface, same workflow.
5. **Observable workforce.** Heartbeat, logs, kill switches. No silent hangs.

---

## Architecture Evolution

### v1 (CLI verbs) — Failed
```
User → Claude Code Chat → node orchestrator.js <verb> → spawns subprocesses
```
Failed because: Gemini hangs (stdin pipe), CLAUDE.md overwrite, environment bleed,
no heartbeat, file-based polling races. See RESEARCH_ANALYSIS.md for full post-mortem.

### v2 (MCP server + subprocesses) — Designed, not built
Solved the Tech Lead interface (MCP tools instead of CLI verbs) but kept subprocess
spawning for workers. Did not solve the fundamental TTY problem.

### v3 (MCP server + Docker workers) — Current design
Docker containers solve TTY/stdin/process-tree issues in one shot. The orchestrator
MCP server is hosted inside Docker MCP Toolkit — no separate hosting.

---

## v3 Architecture

```
+-------------------------------------------------------------+
|                    DEVELOPER (You)                           |
|            "Build me a REST API with auth"                   |
+----------------------------+--------------------------------+
                             | natural language
                             v
+-------------------------------------------------------------+
|       TECH LEAD  (Claude Code  OR  Gemini CLI)              |
|                                                             |
|  Any MCP-capable chat interface. Calls orchestrator tools.  |
|  Not hardcoded to Claude — Gemini can be Tech Lead too.     |
+----------------------------+--------------------------------+
                             | MCP (JSON-RPC over stdio)
                             v
+-------------------------------------------------------------+
|       ORCHESTRATOR MCP SERVER                               |
|       (Node.js — hosted in Docker MCP Toolkit)              |
|                                                             |
|  MCP Tools:                                                 |
|    orchestrate(prompt)      - full pipeline                 |
|    task_status()            - live board                    |
|    task_diff(id)            - git diff of worktree          |
|    task_accept(id)          - merge to main                 |
|    task_reject(id, reason)  - re-queue with feedback        |
|    task_logs(id)            - stdout/stderr tail            |
|    task_kill(id)            - force-stop a worker           |
|    workforce_status()       - all containers + health       |
|                                                             |
|  Internal Modules:                                          |
|    +---------------+ +----------------+ +---------------+   |
|    | Task Manager  | | Docker Runner  | | Worktree Mgr  |  |
|    | (SQLite)      | | (spawn/monitor | | (create/merge |  |
|    |               | |  /kill workers)| |  /prune)      |  |
|    +---------------+ +----------------+ +---------------+   |
|    +---------------+ +----------------+                     |
|    | Token Tracker | | Agent Router   |                     |
|    | (usage/cost)  | | (caps + quota) |                     |
|    +---------------+ +----------------+                     |
+----------------------------+--------------------------------+
                             | docker run --rm -t
               +-------------+-------------+
               |                           |
               v                           v
    +--------------------+    +------------------------+
    |  CLAUDE WORKER     |    |  GEMINI WORKER         |
    |  (Docker container)|    |  (Docker container)    |
    |                    |    |                        |
    |  image: worker-    |    |  image: worker-        |
    |    claude:latest   |    |    gemini:latest       |
    |                    |    |                        |
    |  - Real TTY (-t)   |    |  - Real TTY (-t)      |
    |  - Volume: worktree|    |  - Volume: worktree   |
    |  - Auth via mount  |    |  - Auth via mount     |
    |  - Auto-removed    |    |  - Auto-removed       |
    |  - Timeout enforced|    |  - Timeout enforced   |
    +--------------------+    +------------------------+
               |                           |
               +-----------+---------------+
                           | git merge (on task_accept)
                           v
                   +---------------+
                   |  main branch  |
                   +---------------+
```

---

## Core Components

### 1. Orchestrator MCP Server (`src/mcp-server/index.js`)

Persistent Node.js process hosted in Docker MCP Toolkit. Exposes tools to any MCP client.

**MCP Tools:**

| Tool | Input | Output | Description |
|---|---|---|---|
| `orchestrate` | `{prompt, strategy?}` | `{tasks, status}` | Decompose + assign + execute full pipeline |
| `task_status` | `{id?}` | `TaskBoard` | All tasks or single task detail |
| `task_diff` | `{id}` | `{diff, files}` | Git diff of completed worktree |
| `task_accept` | `{id}` | `{merged, conflicts?}` | Merge worktree branch to main |
| `task_reject` | `{id, reason}` | `{task, re_queued}` | Re-queue with rejection context |
| `task_logs` | `{id, tail?}` | `{stdout, stderr}` | Last N lines of worker output |
| `task_kill` | `{id}` | `{killed, container_id}` | Force-stop a running worker |
| `workforce_status` | — | `{agents, containers}` | Live health of all workers |

**Token Optimization Strategy:**
- `orchestrate` accepts an optional `strategy` field: `"parallel"` (default), `"sequential"`, `"swarm"` (all agents same task, best result wins)
- The decomposition prompt is minimal — no schema examples, no role-play preamble
- Worker context files contain only task description + constraints (no project history)

### 2. Docker Runner (`src/docker/runner.js`)

Manages the lifecycle of worker Docker containers.

**Container spawn:**
```js
docker run --rm -t \
  --name worker-${agentName}-${taskId} \
  -v ${worktreePath}:/work \
  -v ${authDir}:/auth:ro \
  --stop-timeout ${timeoutSec} \
  --memory 2g \
  worker-${agentName}:latest \
  ${cliCommand} ${cliArgs}
```

**Key design decisions:**
- `--rm`: container removed on exit — no cleanup needed
- `-t`: allocates pseudo-TTY — solves all stdin/interactive-mode issues
- `-v worktree:/work`: only the worktree is mounted, not project root
- `-v auth:/auth:ro`: read-only auth credentials mount
- `--stop-timeout`: Docker enforces the timeout at kernel level
- `--memory 2g`: prevents runaway memory consumption

**Monitoring:**
- `docker inspect` polling every 10s for container health
- `docker logs --follow` stream for real-time output capture
- `docker stop` + `docker kill` escalation on timeout
- Container exit code determines task success/failure

### 3. Worker Docker Images

**`worker-gemini` (Dockerfile.gemini):**
```dockerfile
FROM node:22-slim
RUN npm install -g @google/gemini-cli@latest
RUN mkdir -p /work /auth
WORKDIR /work
# Auth: mount ~/.gemini to /auth, symlink at runtime
ENTRYPOINT ["/bin/sh", "-c", \
  "ln -sf /auth /home/node/.gemini && exec gemini \"$@\"", "--"]
```

**`worker-claude` (Dockerfile.claude):**
```dockerfile
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code@latest
RUN mkdir -p /work /auth
WORKDIR /work
ENTRYPOINT ["/bin/sh", "-c", \
  "ln -sf /auth /home/node/.claude && exec claude \"$@\"", "--"]
```

**Auth model:**
- Gemini: OAuth tokens in `~/.gemini/` mounted read-only to `/auth`
- Claude: credentials in `~/.claude/` mounted read-only to `/auth`
- No API keys in env vars or Dockerfiles — auth is always a volume mount

### 4. Task Manager (`src/taskmanager/index.js`) — SQLite Migration

Replaces JSON file + `proper-lockfile` with SQLite (`better-sqlite3`).

**Schema:**
```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  type        TEXT CHECK(type IN ('code','refactor','test','review','debug','research','docs','analysis')),
  status      TEXT CHECK(status IN ('pending','claimed','in_progress','done','failed')) DEFAULT 'pending',
  assigned_to TEXT,
  claimed_at  TEXT,
  completed_at TEXT,
  depends_on  TEXT DEFAULT '[]',   -- JSON array
  result_ref  TEXT,
  worktree_branch TEXT,
  container_id TEXT,
  retries     INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  previous_agents TEXT DEFAULT '[]', -- JSON array
  token_usage TEXT DEFAULT '{}',    -- JSON: {input, output, cache_read, cost_usd}
  created_at  TEXT DEFAULT (datetime('now'))
);
```

**Why SQLite:**
- ACID transactions — no race conditions with parallel workers
- Single file — easy to backup, inspect, reset
- Synchronous via `better-sqlite3` — no async overhead
- 100x faster than JSON read-parse-write-lock cycle

### 5. Agent Router (`src/router/index.js`)

Replaces the inline `assignTasks()` in core.js with a dedicated routing module.

**Routing algorithm:**
1. Match task type to agent capabilities
2. Among capable agents, select by quota ratio (assigned/quota)
3. Avoid agents that previously failed this task
4. Token budget: if an agent's cumulative token usage exceeds its budget, deprioritize

**Token optimization rules:**
- `research`, `docs`, `analysis` → Gemini first (free tier, high token limit)
- `code`, `refactor`, `debug` → Claude first (better at precise edits)
- `test` → either (both competent, route by quota)
- If task description < 200 chars, skip decomposition — execute directly

### 6. Token Tracker (`src/tracker/index.js`)

Records token usage per agent per task. Informs routing decisions.

**Data sources:**
- Claude: `--output-format json` includes `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`
- Gemini: parse token counts from CLI output (format varies by version)

**Stored in SQLite `token_usage` column per task. Aggregated for routing decisions.**

### 7. Worktree Manager (`src/worktree/index.js`)

Extracted from core.js. Manages git worktree lifecycle.

```
.worktrees/
  claude-T1/   <- branch: agent/claude/T1
  gemini-T2/   <- branch: agent/gemini/T2
```

Operations:
- `create(taskId, agentName)` → `git worktree add`
- `merge(taskId)` → `git merge --no-ff` into main
- `diff(taskId)` → `git diff main...branch`
- `prune(taskId)` → `git worktree remove` + `git branch -d`
- `reset()` → remove all worktrees and agent branches

### 8. Workforce Monitor (`src/monitor/index.js`)

Watches all running worker containers. Reports to MCP `workforce_status` tool.

- Polls `docker ps --filter name=worker-` every 10s
- Detects stuck containers (running > 2x timeout)
- Auto-kills containers with no output for 60s (heartbeat)
- Publishes events: `worker.started`, `worker.completed`, `worker.failed`, `worker.killed`

---

## Docker MCP Toolkit Integration

The orchestrator MCP server itself runs inside Docker MCP Toolkit.

**Registration (docker-compose.yml or Docker MCP Toolkit UI):**
```yaml
services:
  orchestrator:
    build: ./docker/orchestrator
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock    # Docker-in-Docker
      - /mnt/d/ALL_AUTOMATION/copilot_adapter:/project
      - ${HOME}/.gemini:/auth/gemini:ro
      - ${HOME}/.claude:/auth/claude:ro
    environment:
      - PROJECT_ROOT=/project
    ports:
      - "3001:3001"   # optional: web dashboard
```

**Docker MCP client connection:**
```bash
docker mcp client connect claude-code
docker mcp client connect gemini
```

This makes the orchestrator tools available in both Claude Code and Gemini CLI sessions.

**Docker-in-Docker:** The orchestrator container has access to the Docker socket, allowing
it to spawn worker containers. This is the standard pattern used by CI/CD systems (Jenkins,
GitLab Runner, etc.).

---

## Agent Configuration (`agents.json`)

```json
{
  "claude-code": {
    "image": "worker-claude:latest",
    "command": "claude",
    "args": ["--print", "--output-format", "json", "--dangerously-skip-permissions"],
    "quota": 30,
    "timeoutMs": 300000,
    "capabilities": ["code", "refactor", "test", "debug"],
    "tokenBudget": { "maxInputPerTask": 50000, "maxOutputPerTask": 16000 },
    "auth": { "mountFrom": "~/.claude", "mountTo": "/auth" }
  },
  "gemini": {
    "image": "worker-gemini:latest",
    "command": "gemini",
    "args": ["-y"],
    "quota": 70,
    "timeoutMs": 120000,
    "capabilities": ["research", "docs", "analysis", "code", "test"],
    "tokenBudget": { "maxInputPerTask": 100000, "maxOutputPerTask": 32000 },
    "auth": { "mountFrom": "~/.gemini", "mountTo": "/auth" }
  }
}
```

---

## Verified Prerequisites (2026-03-24)

| Prerequisite | Status | Details |
|---|---|---|
| WSL (Linux) | OK | Linux 6.6.87.2-microsoft-standard-WSL2 |
| Docker from WSL | OK | Docker 29.2.1, Docker Desktop backend |
| Docker MCP Toolkit | OK | `docker mcp` CLI available, supports claude-code + gemini clients |
| Gemini CLI (host) | OK | v0.34.0, `@google/gemini-cli`, OAuth auth |
| Claude Code (host) | OK | v2.1.81, OAuth auth (Claude Max) |
| Gemini in Docker | NEEDS WORK | Official sandbox image is v0.1.1 (stale). Build custom image with v0.34.0. Auth mount to `/home/node/.gemini` |
| Claude in Docker | NEEDS WORK | Build custom image. Auth mount to `/home/node/.claude` |
| Node.js | OK | v24.14.0 |
| Git | OK | worktrees tested and working |

**Critical finding:** `gemini -p "..." -y < /dev/null` works on the WSL host (completes in seconds).
Docker `-t` flag provides equivalent TTY allocation. No more subprocess hacks needed.

**Critical finding:** Claude `--print --output-format json < /dev/null` returns structured JSON
with full token usage and cost data. Perfect for token tracking.

---

## Token Optimization Strategy

This is the **most important feature** of the system.

### 1. Smart Decomposition
- Analyze task complexity before decomposing. Simple tasks (< 200 chars) skip decomposition.
- Decomposition prompt is minimal — schema only, no examples, no role-play.
- Use Gemini for decomposition (free tier) unless accuracy is critical.

### 2. Context Minimization
- Worker context files contain ONLY: task title, description, constraints.
- No project history, no previous task results, no team config.
- Workers discover context from the code in their worktree (they're AI agents — let them read).

### 3. Routing by Cost
- Free-tier agents (Gemini) handle high-volume, low-precision tasks.
- Premium agents (Claude) handle precision tasks (refactoring, debugging).
- Token budget per agent per task prevents runaway consumption.

### 4. Caching
- Claude supports prompt caching (ephemeral 1h). Structure prompts to maximize cache hits.
- Gemini context caching reduces repeated token consumption.
- Identical decomposition prompts cached at application level (SQLite).

### 5. Swarm Mode (future)
- Multiple agents work the same task. First acceptable result wins.
- Useful for critical tasks where correctness matters more than cost.
- Token cost is higher but success rate is higher.

---

## Directory Structure (v3)

```
copilot_adapter/
+-- docker/
|   +-- orchestrator/
|   |   +-- Dockerfile            # Orchestrator MCP server image
|   |   +-- docker-compose.yml    # Full stack definition
|   +-- workers/
|       +-- Dockerfile.claude     # Claude worker image
|       +-- Dockerfile.gemini     # Gemini worker image
+-- src/
|   +-- mcp-server/
|   |   +-- index.js              # MCP server entry point
|   |   +-- tools.js              # Tool definitions + handlers
|   +-- orchestrator/
|   |   +-- core.js               # Orchestration logic (decompose, assign, execute)
|   |   +-- index.js              # CLI entry point (debug/testing only)
|   +-- docker/
|   |   +-- runner.js             # Docker container lifecycle management
|   +-- taskmanager/
|   |   +-- index.js              # SQLite-backed task state machine
|   |   +-- schema.sql            # Table definitions
|   +-- router/
|   |   +-- index.js              # Agent capability + quota routing
|   +-- tracker/
|   |   +-- index.js              # Token usage tracking
|   +-- worktree/
|   |   +-- index.js              # Git worktree lifecycle
|   +-- monitor/
|   |   +-- index.js              # Workforce health monitoring
|   +-- merger/
|   |   +-- index.js              # Git merge logic (kept from v2)
|   +-- types/
|       +-- index.js              # Type definitions
+-- tests/
|   +-- unit/
|   +-- integration/
+-- .worktrees/                   # Git worktrees per task (gitignored)
+-- agents.json                   # Agent configuration
+-- CLAUDE.md                     # Tech Lead instructions
+-- DESIGN.md                     # This file
+-- PLAN.md                       # Development plan
```

---

## Non-Goals (v3)

- No web UI (MCP tools are the interface; any MCP client is the UI)
- No MQTT / multi-machine (all containers on same Docker host)
- No A2A protocol (MCP is sufficient for our use case)
- No nested teams (single orchestrator, flat worker pool)
- No model fine-tuning or training
