# Multi-Agent Orchestrator

**A vendor-neutral orchestrator that runs Claude Code, Gemini CLI, and Codex as a parallel engineering team — decomposing requests into tasks, executing each in an isolated Docker container + git worktree, and merging results back through a Tech Lead review loop.**

---

## What It Is

Most AI coding tools work in isolation: one agent, one conversation, one context window. This project treats multiple AI CLIs as a team. A Tech Lead (you, via Claude Code or Gemini CLI) decomposes work, dispatches tasks to specialized workers, reviews their diffs, and merges accepted results — all driven by MCP tool calls.

```
┌──────────────────────────────────────────────────────────┐
│              Tech Lead (Claude Code / Gemini CLI)         │
│         plans · reviews diffs · accepts · rejects         │
└────────────────────────┬─────────────────────────────────┘
                         │  MCP (stdio JSON-RPC)
┌────────────────────────▼─────────────────────────────────┐
│                   Orchestrator (MCP Server)               │
│                                                           │
│   decompose ──► route ──► execute ──► merge               │
│    (Gemini      (AgentRouter  (Docker     (git             │
│    planner)      by quota +   workers)    worktrees)       │
│                  capability)                               │
│                                                           │
│                  SQLite task state machine                 │
│       pending ► claimed ► in_progress ► done/failed       │
└──────┬─────────────────┬──────────────────┬──────────────┘
       │                 │                  │
 ┌─────▼──────┐   ┌──────▼─────┐   ┌───────▼────┐
 │  Gemini    │   │ Claude Code │   │   Codex    │
 │  worker    │   │   worker   │   │   worker   │
 │  container │   │  container │   │  container │
 └─────┬──────┘   └──────┬─────┘   └───────┬────┘
       │                 │                  │
 ┌─────▼──────┐   ┌──────▼─────┐   ┌───────▼────┐
 │ git        │   │ git        │   │ git        │
 │ worktree   │   │ worktree   │   │ worktree   │
 │ agent/T1   │   │ agent/T2   │   │ agent/T3   │
 └────────────┘   └────────────┘   └────────────┘
```

---

## How It Works

### 1. Decomposition
When `orchestrate(prompt)` is called, Gemini CLI acts as a free-tier planner: it receives the prompt plus project context (module system, existing source files, dependencies) and returns a JSON array of discrete tasks. Each task has an ID, title, description, type, and dependency list. Short prompts (<200 chars, no newline) skip the planner and become a single task directly.

### 2. Routing
`AgentRouter` assigns each task to an agent using quota-weighted capability matching:
- Tasks are only routed to agents whose `capabilities` list includes the task `type`
- Quota limits are respected per job (e.g. Gemini gets ≤70% of tasks)
- Concurrency limits are enforced per agent (e.g. Gemini runs at most 3 tasks in parallel)
- If an agent was previously assigned and failed a task, it is excluded on retry

### 3. Execution (Docker + git worktrees)
Each task runs in an **ephemeral Docker container** with its own **git worktree**:
- The worktree is a real branch (`agent/<agentName>/<taskId>`) forked from the Tech Lead's current feature branch
- The container mounts the worktree at `/work` with write access and `.git` at `/project-git` read-write
- Auth credentials (OAuth tokens, API keys) are bind-mounted from the host into the container
- Worker guidance files (`GEMINI.md`, `AGENTS.md`) are injected as read-only volume overlays from a tmpdir — the originals in the worktree are never modified, so they can never be accidentally committed
- `git update-index --assume-unchanged` prevents the originals from appearing in `git status` inside the container
- Containers run with `--rm` (auto-removed on exit) and a configurable memory limit (default 2 GB)
- Container stdout/stderr is streamed to `~/.local/share/multi-agent-orchestrator-v3/logs/<taskId>.log`

### 4. State Machine
Task state lives in SQLite at `~/.local/share/multi-agent-orchestrator-v3/tasks.db`:

```
pending ──► claimed ──► in_progress ──► done
                                    └──► failed ──► pending (retry, with backoff)
```

Failed tasks with retries remaining are re-queued with exponential backoff (`queue='retry'`, `retry_after` = 15s / 30s / 60s). The previous agent is excluded from the retry assignment. A killed task (`task_kill`) is permanently failed — retries are exhausted immediately.

### 5. Review and Merge
The Tech Lead reviews each completed task by calling `task_diff(id)` — a git diff of the worktree branch versus the base. After reviewing:
- `task_accept(id)` — merges the worktree branch into the Tech Lead's feature branch and removes the worktree
- `task_reject(id, reason)` — re-queues the task with the reason appended to its description; the next agent gets the original requirements plus the failure feedback
- `task_discard(id)` — permanently closes the task without merging

---

## Quick Start

### Prerequisites

- **Node.js 20+**
- **Git 2.5+** (worktree support)
- **Docker** (running — workers execute in containers)
- At least one AI CLI authenticated on the host:
  - Claude Code: `npm i -g @anthropic-ai/claude-code` — authenticate with `claude`
  - Gemini CLI: `npm i -g @google/gemini-cli` — authenticate with `gemini`
  - Codex CLI: `npm i -g @openai/codex` — authenticate with `codex`

### Install

```bash
git clone <this-repo>
cd copilot_adapter
npm install
```

### Build worker images

```bash
npm run build:workers
# or individually:
docker build -t worker-gemini:latest -f docker/workers/Dockerfile.gemini .
docker build -t worker-claude:latest -f docker/workers/Dockerfile.claude .
docker build -t worker-codex:latest  -f docker/workers/Dockerfile.codex  .
```

### Start the MCP server

```bash
npm start
# or: node src/mcp-server/index.js
```

The server speaks MCP over stdio. Connect your Tech Lead (Claude Code or Gemini CLI) to it via the MCP client config in your IDE or CLI settings.

### Run tests

```bash
npm test   # 96 tests, node:test runner, no Jest/Mocha required
```

---

## MCP Tools

The orchestrator exposes 10 tools over MCP. The Tech Lead calls these instead of writing code directly.

| Tool | Arguments | Description |
|------|-----------|-------------|
| `orchestrate` | `prompt` | Full pipeline: decompose → assign → execute. Returns the task board when complete. |
| `task_status` | `id?` | Live board (all tasks) or a single task's state. |
| `task_diff` | `id` | Git diff of the completed worktree vs the base branch. **Always call before accepting.** |
| `task_accept` | `id` | Merge the worktree branch into the Tech Lead's feature branch. Cleans up the worktree. |
| `task_reject` | `id`, `reason` | Re-queue the task with rejection feedback appended to the description. |
| `task_discard` | `id` | Permanently close a task without merging. |
| `task_logs` | `id`, `tail?` | Last N lines of the container's stdout/stderr (falls back to log file after container exits). |
| `task_kill` | `id` | Force-stop a running container and permanently fail the task (no retry). |
| `workforce_status` | — | Running containers + task board summary. |
| `task_reset` | — | Clear all tasks and jobs from the database. Use between jobs. |

---

## Agent Configuration

`agents.json` at the project root controls each agent's quota, concurrency, Docker image, and capabilities. It is hot-reloaded on every `orchestrate()` call — no server restart needed.

```json
{
  "claude-code": {
    "image": "worker-claude:latest",
    "concurrency": 1,
    "capabilities": ["code", "refactor", "test", "debug", "review"],
    "quota": 20,
    "timeoutMs": 300000,
    "tokenBudget": { "maxInputPerTask": 50000, "maxOutputPerTask": 16000 },
    "auth": { "mountFrom": "~/.claude", "mountTo": "/home/node/.claude", "mode": "ro" }
  },
  "gemini": {
    "image": "worker-gemini:latest",
    "concurrency": 3,
    "capabilities": ["research", "docs", "analysis", "code", "test", "refactor", "debug", "review"],
    "quota": 70,
    "timeoutMs": 300000,
    "tokenBudget": { "maxInputPerTask": 100000, "maxOutputPerTask": 32000 },
    "auth": { "mountFrom": "~/.gemini", "mountTo": "/home/node/.gemini", "mode": "rw" }
  },
  "codex": {
    "image": "worker-codex:latest",
    "concurrency": 2,
    "capabilities": ["research", "docs", "analysis", "code", "test", "refactor", "debug", "review"],
    "quota": 10,
    "timeoutMs": 300000,
    "tokenBudget": { "maxInputPerTask": 100000, "maxOutputPerTask": 32000 },
    "auth": { "mountFrom": "~/.codex", "mountTo": "/home/node/.codex", "mode": "rw" }
  }
}
```

**`quota`** — maximum percentage of tasks in a job that can be assigned to this agent.
**`concurrency`** — maximum parallel containers for this agent.
**`auth.mode`** — `ro` for Claude (credentials are read-only); `rw` for Gemini/Codex (they write session state back to the auth dir). Gemini auth is further isolated: credentials are copied to a per-task tmpdir so session history never accumulates between tasks.

---

## Worker Images

Each agent runs in a dedicated Docker image:

| Image | Base | Installed CLI | Notes |
|-------|------|---------------|-------|
| `worker-gemini:latest` | `node:22-slim` | `@google/gemini-cli@0.34.0` | `git`, `procps`; pre-configured git identity; settings.json override disables host MCP servers |
| `worker-claude:latest` | `node:22-slim` | `@anthropic-ai/claude-code@latest` | `git`; auth mounted read-only |
| `worker-codex:latest` | `node:22-slim` | `@openai/codex@latest` | `git` |

Worker guidance files (`GEMINI.md`, `AGENTS.md`) are injected at runtime as read-only bind-mounts — workers receive task-specific instructions without any risk of committing them.

---

## Session State

All state is stored in `~/.local/share/multi-agent-orchestrator-v3/` (ext4, WSL2-safe):

```
~/.local/share/multi-agent-orchestrator-v3/
  tasks.db          # SQLite — jobs, tasks, status, token usage, retry state
  logs/
    T1.log          # container stdout+stderr for each task (persists after --rm)
    T2.log
    ...
```

Worktrees live inside the project under `.worktrees/` (gitignored):

```
.worktrees/
  gemini-T1/        # worktree for task T1 assigned to gemini
  claude-T2/        # worktree for task T2 assigned to claude-code
```

To fully reset state between sessions:

```bash
npm run reset-state
```

This kills the MCP server, removes all worktrees, deletes all `agent/*` branches, and wipes the SQLite database.

---

## Tech Lead Workflow

The standard session pattern (described in `.agent/TECH-LEAD.md`):

```bash
# 1. Start fresh on a feature branch
git checkout master && git pull
git checkout -b feat/<description>

# 2. Clear any stale tasks from a previous session
task_reset()

# 3. Dispatch work to the agent workforce
orchestrate("Build a rate-limiter middleware with unit tests")

# 4. Monitor progress
task_status()
workforce_status()

# 5. For each completed task — review then decide
task_diff("T1")      # read the diff first, always
task_accept("T1")    # if correct and complete
task_reject("T2", "Missing error handling for 429 responses — add it")

# 6. When all tasks are done — test and merge
npm test             # must be 0 failures
gh pr create ...

# 7. Clean up
npm run reset-state
```

---

## Programmatic Usage

```js
import { Orchestrator } from './src/orchestrator/core.js';

const orchestrator = new Orchestrator('/path/to/your/project');
await orchestrator.initialize();

const result = await orchestrator.orchestrate('Add rate limiting to the API');
console.log(result.tasks);
// [{ id: 'T1', title: '...', status: 'done', assigned_to: 'gemini', token_usage: {...} }]
```

---

## Project Structure

```
src/
  orchestrator/core.js      # main orchestration logic (decompose, assign, execute, merge)
  mcp-server/
    index.js                # MCP stdio server entry point
    tools.js                # tool definitions and handlers
  taskmanager/
    index.js                # SQLite state machine (updateStatus, retryDue, getClaimableTasks)
    schema.sql              # jobs and tasks table schema
  docker/runner.js          # container lifecycle (spawn, kill, logs, inspect)
  worktree/index.js         # git worktree create/remove/changedFiles
  router/index.js           # capability + quota-based agent routing
  logger/index.js           # stderr-only logger (stdout reserved for MCP JSON-RPC)
docker/
  workers/
    Dockerfile.gemini       # Gemini worker image
    Dockerfile.claude       # Claude Code worker image
    Dockerfile.codex        # Codex worker image
    config/
      gemini-settings.json  # worker-safe Gemini settings (no MCP servers)
agents.json                 # agent capabilities, quotas, images (hot-reloaded)
AGENTS.md                   # worker prompt specification for all agents
GEMINI.md                   # Tech Lead instructions for Gemini CLI sessions
CLAUDE.md                   # Tech Lead instructions for Claude Code sessions
.agent/TECH-LEAD.md         # full Tech Lead operating rules (agent-agnostic)
```

---

## Comparison

| Feature | **This project** | MCO | AWS CAO |
|---------|-----------------|-----|---------|
| Primary interface | MCP tools (chat-driven) | CLI verbs | Python SDK |
| Worker isolation | Docker containers + git worktrees | None | tmux sessions |
| State persistence | SQLite (ext4, WAL-safe) | JSON files | Session-based |
| Retry with backoff | Yes — exponential, per-agent exclusion | No | No |
| Tech Lead review loop | Yes — diff → accept/reject/retry | No | No |
| Stub injection | Docker volume overlay (`:ro`) | N/A | N/A |
| Agents supported | Claude Code, Gemini CLI, Codex | Claude, Codex, Gemini | Kiro, Claude, Codex, Gemini |
| Hot-reload config | Yes (`agents.json` per call) | No | No |

---

## Contributing

1. Fork and clone the repo
2. `npm install`
3. Build worker images: `npm run build:workers`
4. Make changes — keep ES module syntax (`import`/`export`, `.js` extensions)
5. `npm test` before submitting (must be 0 failures, node:test runner)
6. All task state mutations must go through `TaskManager` — never write to `tasks.db` directly outside of it
7. MCP tools must not write to stdout except via the MCP SDK — use `Logger` (stderr only)

---

## License

MIT
