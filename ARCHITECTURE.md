# Architecture — Multi-Agent Orchestrator v3

## 1. System Overview

The v3 orchestrator is a multi-agent execution system that decomposes software
engineering requests into parallelizable tasks, routes each task to the best-fit
agent (Gemini or Claude Code), runs agents in isolated Docker containers with
dedicated git worktrees, and merges accepted results back into the main branch.

It is exposed to clients (Claude Code, Gemini CLI) as an MCP server over stdio.

```
MCP Client (Claude Code / Gemini CLI)
        │  MCP (stdio)
        ▼
  ┌─────────────┐
  │  MCP Server │  ← registers tools, routes calls
  └──────┬──────┘
         │
  ┌──────▼──────────┐
  │  Orchestrator   │  ← coordinates all subsystems
  │     Core        │
  └──┬──┬──┬──┬─────┘
     │  │  │  │
     │  │  │  └── AgentRouter  (capability + quota routing)
     │  │  └───── WorktreeManager (git isolation per task)
     │  └──────── DockerRunner (container lifecycle)
     └─────────── TaskManager (SQLite state machine)
```

## 2. Key Components

### MCP Server (`src/mcp-server/`)
Persistent daemon using `@modelcontextprotocol/sdk`. Registers 8 tools and
delegates each call to `Orchestrator`. Runs over stdio so any MCP-capable
client can connect.

### Orchestrator Core (`src/orchestrator/core.js`)
Central coordinator. Owns the task lifecycle: decompose → assign → execute →
collect results. Loads agent config from `agents.json`, builds the router,
and drives the polling loop that dispatches pending tasks.

### Task Manager (`src/taskmanager/`)
SQLite-backed (better-sqlite3, WAL mode) state machine with ACID guarantees.

States: `pending → claimed → in_progress → done` (failures retry back to `pending`).

Rejection re-queues a `done` task back to `pending` with a reason appended.

### Docker Runner (`src/docker/runner.js`)
Spawns ephemeral `docker run --rm` containers per task. Mounts the task
worktree as `/work` and agent auth credentials read-only. Enforces a 2 GB
memory cap and per-agent timeouts. Streams stdout/stderr for result parsing.

### Worktree Manager (`src/worktree/`)
Creates isolated git worktrees under `.worktrees/<agent>-<taskId>/` on a
dedicated branch `agent/<agent>/<taskId>`. Prevents agents from conflicting
on shared files. `task_accept` merges the branch and removes the worktree.

### Agent Router (`src/router/index.js`)
Assigns tasks to agents using capability matching and quota-weighted load
balancing. Quota ratio = `assignedCount / quota`; the agent with the lowest
ratio is preferred. Agents already attempted for a task are deprioritized.

## 3. End-to-End Task Flow

```
orchestrate(prompt)
  │
  ├─1─ decomposeTasks(prompt)
  │      └─ Gemini planner → JSON task array → TaskManager.addTasks()
  │
  ├─2─ AgentRouter.assign(pendingTasks)
  │      └─ match capabilities, apply quota weights → [{task, agentName}]
  │
  ├─3─ For each assignment (parallel):
  │      ├─ WorktreeManager.create(taskId, agentName)  → isolated branch
  │      ├─ TaskManager.transition(taskId, 'in_progress')
  │      └─ DockerRunner.run(agent, worktreePath, prompt)
  │           └─ docker run worker-<agent>:latest …
  │
  ├─4─ Collect outputs, parse per-agent format
  │      └─ TaskManager.transition(taskId, 'done' | 'failed')
  │
  └─5─ Return task board to MCP caller

task_accept(taskId)
  ├─ git merge agent/<agent>/<taskId> → main
  ├─ WorktreeManager.remove(taskId, agentName)
  └─ TaskManager mark accepted
```

## 4. Agent Roster

| Agent | Image | Capabilities | Quota | Timeout |
|---|---|---|---|---|
| `gemini` | `worker-gemini:latest` | research, docs, analysis, code, test | 70 % | 2 min |
| `claude-code` | `worker-claude:latest` | code, refactor, test, debug, review | 30 % | 5 min |

**Routing heuristic:** Gemini handles research/docs/analysis by default (free
tier conserves Claude quota). Claude handles precision code/debug/refactor tasks.
Token usage is tracked per task in SQLite.

Auth credentials are bind-mounted from the host (`~/.gemini`, `~/.claude`) into
each container at runtime — images contain no credentials.
