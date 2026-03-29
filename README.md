# Multi-Agent Orchestrator

**Run Claude Code, Gemini CLI, and Codex as a parallel engineering team — coordinated by a Tech Lead through MCP tools, with Docker-isolated execution, git worktree branching, and a SQLite state machine.**

---

## What It Is

Most AI coding tools work alone. This project runs multiple AI CLIs as a team. A Tech Lead (you, via Claude Code or Gemini CLI) dispatches work to specialized worker agents, reviews their diffs, and merges accepted results — all through MCP tool calls. Workers never share context or interfere: each runs in its own Docker container against its own git worktree.

### Key capabilities

- **Parallel execution** — multiple agents work simultaneously on independent tasks
- **Delegation** — a running agent can hand off sub-tasks to a specialist; results merge back automatically
- **Review loop** — every completed task produces a git diff the Tech Lead reviews before accepting
- **Conflict detection** — merge conflicts surface in `result_data` with file-level detail; conflicted worktrees are preserved for inspection
- **Retry with backoff** — failed tasks re-queue automatically with the failing agent excluded
- **Hot-reload config** — edit `agents.json` between calls; no server restart needed

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│              Tech Lead (Claude Code / Gemini CLI)          │
│         orchestrate · delegate · diff · accept · reject    │
└─────────────────────────┬─────────────────────────────────┘
                          │  MCP over stdio (JSON-RPC 2.0)
┌─────────────────────────▼─────────────────────────────────┐
│                  Orchestrator (MCP Server)                  │
│                                                            │
│  orchestrate()  ──►  decompose (Gemini planner)            │
│                 ──►  route (AgentRouter: quota + capability)│
│                 ──►  execute (_runTask per agent)           │
│                 ──►  auto-commit + merge (WorktreeManager)  │
│                                                            │
│  delegate()     ──►  auto-commit parent worktree           │
│                 ──►  branch child from parent HEAD         │
│                 ──►  _runTask (inline, blocking)           │
│                 ──►  merge-back with conflict detection     │
│                                                            │
│               SQLite task state machine                    │
│    pending ► claimed ► in_progress ► done / failed         │
└──────┬──────────────────┬─────────────────┬───────────────┘
       │                  │                 │
 ┌─────▼──────┐   ┌───────▼─────┐   ┌──────▼─────┐
 │  Gemini    │   │ Claude Code │   │   Codex    │
 │  worker    │   │   worker    │   │   worker   │
 │ container  │   │  container  │   │ container  │
 └─────┬──────┘   └──────┬──────┘   └──────┬─────┘
       │                 │                 │
 ┌─────▼──────┐   ┌──────▼──────┐   ┌──────▼─────┐
 │ git        │   │ git         │   │ git        │
 │ worktree   │   │ worktree    │   │ worktree   │
 │ agent/T1   │   │ agent/T2    │   │ agent/T3   │
 └────────────┘   └─────────────┘   └────────────┘
```

---

## How It Works

### Decomposition

`orchestrate(prompt)` sends the prompt to Gemini CLI as a free-tier planner. Gemini returns a JSON array of discrete tasks (ID, title, description, type, dependencies). Short prompts (<200 chars, no newlines) skip the planner and become a single task directly.

### Routing

`AgentRouter` assigns each task using capability matching and quota enforcement:

- Only agents whose `capabilities` list includes the task `type` are eligible
- Quota caps how many tasks per job each agent can receive (e.g. Gemini ≤70%)
- Concurrency caps how many containers each agent runs in parallel
- On retry, the previously failing agent is excluded

### Execution

Each task runs in an ephemeral Docker container with a dedicated git worktree:

- Worktree branch: `agent/<agentName>/<taskId>`, forked from the current feature branch
- Container mounts the worktree at `/work` with write access; `.git` is available read-write
- Auth credentials are bind-mounted from the host (read-only for Claude; isolated per-task tmpdir for Gemini)
- Worker guidance files (`GEMINI.md`, `CLAUDE.md`, `AGENTS.md`) are injected as read-only volume overlays — the originals in the worktree are never touched
- `git update-index --assume-unchanged` hides the originals from `git status` inside the container
- Container stdout/stderr streams to `~/.local/share/multi-agent-orchestrator-v3/logs/<taskId>.log`
- Any uncommitted changes the agent leaves behind are auto-committed before merge

### Delegation

`delegate(subagentName, prompt, type, parentTaskId?)` enables mid-execution sub-tasking:

1. **Parent auto-commit** — the parent's worktree is committed so the child can see its latest work
2. **Child branches from parent HEAD** — not from master; the child inherits the parent's in-progress state
3. **Blocking execution** — the orchestrator runs the child task inline and waits for it
4. **Merge-back with conflict detection** — the child branch is merged back; `resultData` contains:
   - `merged: true/false`
   - `conflicts: true/false`
   - `conflicting_files: string[]` (populated on conflict)
5. **Conflict preservation** — on conflict, the child worktree is kept so `task_diff(childId)` still works

Research/analysis/docs tasks skip merge-back entirely (`merged` and `conflicts` are undefined).

### State Machine

```
pending ──► claimed ──► in_progress ──► done
                                    └──► failed ──► pending (retry, backoff)
```

Failed tasks with remaining retries re-queue with exponential backoff (15s / 30s / 60s). The failing agent is excluded from the next assignment. `task_kill` permanently fails a task — retries exhausted immediately.

### Review and Merge

The Tech Lead calls `task_diff(id)` to inspect every completed task. The diff is prefixed with a delegation header when relevant:

```
subagent:  gemini
provider:  gemini
depth:     1
parent:    T1
```

After reviewing:
- `task_accept(id)` — merges the branch and removes the worktree
- `task_reject(id, reason)` — re-queues with feedback appended to the task description
- `task_discard(id)` — permanently closes without merging

---

## Quick Start

### Prerequisites

- **Node.js 20+**
- **Git 2.5+** (worktree support)
- **Docker** (running)
- At least one AI CLI authenticated on the host:
  - Claude Code: `npm i -g @anthropic-ai/claude-code` then `claude` to auth
  - Gemini CLI: `npm i -g @google/gemini-cli` then `gemini` to auth
  - Codex CLI: `npm i -g @openai/codex` then `codex` to auth

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

### Configure the MCP server

Add to your Claude Code or Gemini CLI MCP config:

```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["/path/to/copilot_adapter/src/mcp-server/index.js"]
    }
  }
}
```

### Run tests

```bash
npm test   # 164 tests, node:test runner, 0 failures required
```

---

## MCP Tools

12 tools exposed over MCP. The Tech Lead calls these instead of writing code directly.

| Tool | Arguments | Description |
|------|-----------|-------------|
| `orchestrate` | `prompt` | Full pipeline: decompose → assign → execute. Blocks until all tasks complete. |
| `delegate` | `subagent_name`, `prompt`, `type?`, `parent_task_id?` | Hand off a task to a specific agent inline. Merge-back runs automatically for code tasks. |
| `list_subagents` | — | Show all configured agents with capabilities, quota, and current availability. |
| `task_status` | `id?`, `subagent_name?` | All tasks, a single task by ID, or all tasks for a given subagent role. |
| `task_diff` | `id` | Git diff of the completed worktree vs base. Prepends delegation header. **Always call before accepting.** |
| `task_accept` | `id` | Merge the worktree branch into the current feature branch. Removes the worktree. |
| `task_reject` | `id`, `reason` | Re-queue with rejection feedback. Next agent gets original requirements + failure context. |
| `task_discard` | `id` | Permanently close a task without merging. |
| `task_logs` | `id`, `tail?` | Last N lines of container stdout/stderr (falls back to log file after container exits). |
| `task_kill` | `id` | Force-stop a running container. Permanently fails the task (no retry). |
| `workforce_status` | — | Live container list + task board summary + active delegation counts per agent. |
| `task_reset` | — | Clear all tasks and jobs. Use between jobs. |

---

## Agent Configuration

`agents.json` controls each agent's quota, concurrency, image, and capabilities. Hot-reloaded on every `orchestrate()` call.

```json
{
  "claude-code": {
    "image": "worker-claude:latest",
    "concurrency": 1,
    "capabilities": ["code", "refactor", "test", "debug", "review"],
    "quota": 20,
    "timeoutMs": 300000,
    "auth": { "mountFrom": "~/.claude", "mountTo": "/home/node/.claude", "mode": "ro" }
  },
  "gemini": {
    "image": "worker-gemini:latest",
    "concurrency": 3,
    "capabilities": ["research", "docs", "analysis", "code", "test", "refactor", "debug", "review"],
    "quota": 70,
    "timeoutMs": 300000,
    "auth": { "mountFrom": "~/.gemini", "mountTo": "/home/node/.gemini", "mode": "rw" }
  },
  "codex": {
    "image": "worker-codex:latest",
    "concurrency": 2,
    "capabilities": ["research", "docs", "analysis", "code", "test", "refactor", "debug", "review"],
    "quota": 10,
    "timeoutMs": 300000,
    "auth": { "mountFrom": "~/.codex", "mountTo": "/home/node/.codex", "mode": "rw" }
  }
}
```

**`quota`** — max percentage of tasks in a job assigned to this agent.
**`concurrency`** — max parallel containers.
**`auth.mode`** — `ro` for Claude (credentials are read-only); `rw` for Gemini/Codex (they write session state). Gemini auth is isolated per-task into a tmpdir so session history never accumulates.

---

## Typical Workflow

```bash
# 1. Start on a feature branch
git checkout master && git pull
git checkout -b feat/my-feature

# 2. Clear any stale tasks
task_reset()

# 3. Dispatch work to the workforce
orchestrate("Add rate-limiting middleware with unit tests")

# 4. Monitor
task_status()
workforce_status()

# 5. Review and decide on each completed task
task_diff("T1")                          # always read the diff first
task_accept("T1")                        # looks good → merge
task_reject("T2", "Missing 429 handler") # needs rework → re-queue
task_discard("T3")                       # no longer needed

# 6. Delegate a sub-task directly
delegate("gemini", "Summarize the auth module", "research")
delegate("claude-code", "Refactor session.js based on the summary", "code")

# 7. Test and ship
npm test
gh pr create ...

# 8. Clean up
npm run reset-state
```

---

## Delegation Example

A Tech Lead task can spawn a sub-task mid-execution:

```
Tech Lead calls: delegate("claude-code", "Refactor auth flow", "code", "T1")

  Orchestrator:
    1. Auto-commits T1's worktree (so claude-code sees latest state)
    2. Creates child worktree branched from T1's HEAD
    3. Runs claude-code in Docker against the child worktree
    4. Merges child branch back into T1's branch
    5. Returns: { merged: true, conflicts: false, files_changed: [...] }

  On conflict:
    Returns: { merged: false, conflicts: true, conflicting_files: ["src/auth/session.js"] }
    Child worktree preserved → task_diff(childId) still works
```

Delegation depth is capped at 3 (configurable via `MAX_DELEGATE_DEPTH`). Orphaned delegated tasks (e.g. after server restart) are automatically recovered to `failed` on next `initialize()`.

---

## Project Structure

```
src/
  orchestrator/core.js      # decompose, route, execute, delegate, merge
  mcp-server/
    index.js                # MCP stdio server entry point
    tools.js                # tool definitions + handlers (12 tools)
  taskmanager/
    index.js                # SQLite state machine
    schema.sql              # jobs + tasks schema
  docker/runner.js          # container lifecycle (spawn, kill, logs)
  worktree/index.js         # git worktree create/merge/prune/diff
  router/index.js           # capability + quota-based routing
  providers/                # per-provider CLI args + output parsers
    gemini.js
    claude.js
    codex.js
    registry.js
  logger/index.js           # stderr-only logger (stdout = MCP JSON-RPC)
docker/
  workers/
    Dockerfile.gemini
    Dockerfile.claude
    Dockerfile.codex
agents.json                 # agent config (hot-reloaded)
AGENTS.md                   # worker prompt specification
GEMINI.md                   # Tech Lead config for Gemini CLI sessions
CLAUDE.md                   # Tech Lead config for Claude Code sessions
.agent/TECH-LEAD.md         # full Tech Lead operating rules
```

---

## Session State

All state at `~/.local/share/multi-agent-orchestrator-v3/`:

```
tasks.db          # SQLite — jobs, tasks, token usage, retry state, delegation tree
logs/
  T1.log          # container stdout+stderr (persists after --rm)
  T2.log
```

Worktrees at `.worktrees/` (gitignored):

```
.worktrees/
  gemini-T1/      # branch: agent/gemini/T1
  claude-T2/      # branch: agent/claude-code/T2
```

Full reset:

```bash
npm run reset-state   # kills server, removes worktrees, deletes agent/* branches, wipes DB
```

---

## Contributing

1. `npm install`
2. Build worker images: `npm run build:workers`
3. Keep ES module syntax (`import`/`export`, `.js` extensions on all imports)
4. All task state mutations go through `TaskManager` — never write to `tasks.db` directly (except the intentional raw SQL patch for `result_data` on completed tasks, which bypasses the `done→done` state machine guard)
5. MCP tools must not write to stdout — use `Logger` (stderr only)
6. `npm test` → 0 failures before every commit

---

## License

MIT
