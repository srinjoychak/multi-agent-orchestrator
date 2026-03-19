# Multi-Agent Orchestrator — Design Document

## Project: copilot_adapter (POC v1)

### Vision

A vendor-neutral orchestration layer that coordinates heterogeneous AI coding agents
(Claude Code, Gemini CLI, and future agents) working as a team on software engineering
tasks. Each agent operates through a standardized adapter interface, communicates via
a shared file-based protocol, and works in isolated git worktrees to avoid conflicts.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│              User / CLI Interface                 │
│         (node orchestrator.js "prompt")           │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│              Orchestrator (Leader)                │
│                                                   │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────┐ │
│  │ Task Planner │ │ Task Manager │ │  Merger   │ │
│  │ (decompose)  │ │ (assign/     │ │ (combine  │ │
│  │              │ │  monitor)    │ │  results) │ │
│  └─────────────┘ └──────────────┘ └───────────┘ │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │         Communication Layer (Comms)           │ │
│  │    File-based IPC  ←→  (future: MQTT)        │ │
│  └──────────────────────────────────────────────┘ │
└──────────┬──────────────────┬────────────────────┘
           │ spawns           │ spawns
     ┌─────▼─────┐     ┌─────▼─────┐
     │  Adapter   │     │  Adapter   │
     │  Claude    │     │  Gemini    │
     │  Code      │     │  CLI       │
     └─────┬─────┘     └─────┬─────┘
           │                  │
     ┌─────▼─────┐     ┌─────▼─────┐
     │ git        │     │ git        │
     │ worktree   │     │ worktree   │
     │ branch-1   │     │ branch-2   │
     └───────────┘     └───────────┘
```

---

## Core Components

### 1. Orchestrator (`src/orchestrator/index.js`)

The central coordinator. Responsibilities:
- Parse user request into a structured task plan
- Decompose work into independent, assignable tasks
- Select which adapter handles which task (round-robin for v1, smart assignment later)
- Monitor task progress via file-system watchers
- Merge results when all tasks complete
- Maintain a structured session log

**Does NOT**: execute any AI work itself. It is purely a coordinator.

### 2. Task Manager (`src/taskmanager/`)

Manages the shared task list as a JSON file.

**Task Schema:**
```json
{
  "id": "T1",
  "title": "Implement user authentication middleware",
  "description": "Create Express middleware for JWT-based auth...",
  "status": "pending",          // pending | claimed | in_progress | done | failed
  "assigned_to": null,          // "claude-code" | "gemini" | null
  "claimed_at": null,           // ISO timestamp
  "completed_at": null,         // ISO timestamp
  "depends_on": [],             // ["T0"] — blocked until dependency is done
  "result_ref": null,           // path to result file
  "worktree_branch": null,      // git branch name for this task
  "retries": 0,
  "max_retries": 1
}
```

**Task State Machine:**
```
  pending ──► claimed ──► in_progress ──► done
     │            │            │
     │            │            └──► failed ──► pending (retry)
     │            └──► pending (unclaim after timeout)
     └──► blocked (has unresolved depends_on)
```

**Concurrency**: File-level locking via `proper-lockfile` to prevent race conditions
when two adapters try to claim the same task.

### 3. Adapters (`src/adapters/`)

Each adapter implements the `AgentAdapter` interface:

```typescript
interface AgentAdapter {
  name: string;                           // "claude-code" | "gemini"
  isAvailable(): Promise<boolean>;        // check if CLI is installed
  execute(task: Task, context: TaskContext): Promise<TaskResult>;
  abort(): Promise<void>;                 // cancel running task
}

interface TaskContext {
  workDir: string;        // git worktree path
  branch: string;         // branch name
  projectRoot: string;    // original project root
  teamConfig: object;     // shared team config
}

interface TaskResult {
  status: "done" | "failed";
  summary: string;
  filesChanged: string[];
  output: string;         // raw CLI output
  duration_ms: number;
}
```

#### Claude Code Adapter (`src/adapters/claude-code.js`)
- Invokes: `claude -p "<prompt>" --output-format json`
- Works in: assigned git worktree
- Returns: structured JSON output
- Strengths: architecture, refactoring, complex multi-file changes

#### Gemini CLI Adapter (`src/adapters/gemini.js`)
- Invokes: `gemini -p "<prompt>" --output-format json`
- Works in: assigned git worktree
- Returns: structured JSON output
- Strengths: large context window, research, analysis, security review

### 4. Communication Layer (`src/comms/`)

Abstracted behind a `CommChannel` interface so the transport can be swapped.

```typescript
interface CommChannel {
  send(to: string, message: AgentMessage): Promise<void>;
  receive(agentId: string): Promise<AgentMessage[]>;
  broadcast(message: AgentMessage): Promise<void>;
  subscribe(agentId: string, callback: (msg: AgentMessage) => void): void;
}

interface AgentMessage {
  id: string;
  from: string;          // "orchestrator" | "claude-code" | "gemini"
  to: string;            // target agent or "broadcast"
  type: string;          // "task_assigned" | "task_update" | "finding" | "question" | "shutdown"
  payload: object;
  timestamp: string;     // ISO
}
```

#### v1: File-based transport (`FileCommChannel`)
- Inbox directories per agent: `.agent-team/inbox/{agent-name}/`
- Messages are JSON files named `{timestamp}-{id}.json`
- Polling via `fs.watch` / `chokidar`
- Broadcast writes to all inboxes

#### Future: MQTT transport (`MqttCommChannel`)
See [MQTT Design Note](#mqtt-design-note) below.

### 5. Result Merger (`src/merger/`)

After all tasks complete:
- Collects result files from `.agent-team/results/`
- Attempts to merge git branches (worktree → main branch)
- Reports conflicts for manual resolution
- Generates a summary report

---

## Git Worktree Strategy

Each agent gets an isolated copy of the repo:

```bash
# Orchestrator creates worktrees before spawning adapters
git worktree add .worktrees/claude-code-T1 -b agent/claude-code/T1
git worktree add .worktrees/gemini-T2 -b agent/gemini/T2
```

After completion:
```bash
# Merge successful branches
git merge agent/claude-code/T1
git merge agent/gemini/T2

# Cleanup
git worktree remove .worktrees/claude-code-T1
git worktree remove .worktrees/gemini-T2
```

---

## MQTT Design Note

The user's original design proposed MQTT (Mosquitto) as the inter-agent message bus.
This is a sound architectural choice, but **deferred to v2** for the following reasons:

### When MQTT becomes valuable

| Scenario | File-based | MQTT needed? |
|----------|-----------|-------------|
| All agents on same machine | Yes | No |
| Agents on different machines / containers | No | **Yes** |
| Real-time event streaming (< 10ms latency) | Polling lag | **Yes** |
| Team size > 5 agents | Gets noisy | **Yes** |
| CI/CD pipeline integration | Possible | **Better** |
| Persistent message history / replay | Manual | **Yes** |
| Fan-out to N subscribers | N file writes | **Native** |

### Proposed MQTT topic structure (for v2)

```
team/{team-id}/tasks/created       — new tasks published by leader
team/{team-id}/tasks/claimed       — agent claims a task
team/{team-id}/tasks/status        — status updates (in_progress, done, failed)
team/{team-id}/agent/{name}/inbox  — directed messages to specific agent
team/{team-id}/broadcast           — all agents subscribe
team/{team-id}/heartbeat           — agent liveness (QoS 1, retain=true)
```

### Why MQTT over Kafka for this use case

- **Latency**: MQTT delivers in sub-millisecond; Kafka batches (50-200ms default)
- **Footprint**: Mosquitto is ~5MB; Kafka needs JVM + ZooKeeper/KRaft
- **QoS levels**: MQTT QoS 2 = exactly-once delivery per message
- **Retained messages**: Last-known task state available to new subscribers immediately
- **LWT (Last Will)**: Agent crash auto-publishes "agent offline" — free failure detection

### Migration path

The `CommChannel` interface is designed so that `FileCommChannel` can be swapped for
`MqttCommChannel` with zero changes to orchestrator or adapter code. The adapters
never know which transport they're using.

---

## Directory Structure

```
copilot_adapter/
├── .claude/
│   └── settings.local.json       # Agent teams enabled (workspace-scoped)
├── .agent-team/                   # Runtime state (gitignored)
│   ├── tasks.json                 # Shared task list
│   ├── session-log.json           # Structured leader log
│   ├── inbox/
│   │   ├── claude-code/           # Messages for Claude Code adapter
│   │   └── gemini/                # Messages for Gemini adapter
│   ├── outbox/                    # Broadcast messages
│   └── results/                   # Task result files (T1.json, T2.json...)
├── .worktrees/                    # Git worktrees per agent (gitignored)
├── src/
│   ├── orchestrator/
│   │   └── index.js               # Main orchestrator / leader logic
│   ├── adapters/
│   │   ├── base.js                # AgentAdapter base class
│   │   ├── claude-code.js         # Claude Code CLI adapter
│   │   └── gemini.js              # Gemini CLI adapter
│   ├── taskmanager/
│   │   └── index.js               # Task CRUD, locking, state machine
│   ├── comms/
│   │   ├── channel.js             # CommChannel interface
│   │   └── file-channel.js        # File-based implementation
│   ├── merger/
│   │   └── index.js               # Git merge + result aggregation
│   └── types/
│       └── index.js               # Shared type definitions / schemas
├── DESIGN.md                      # This file
├── DEVELOPMENT_PLAN.md            # Sprint plan and objectives
├── MARKET_RESEARCH.md             # Competitive landscape
├── package.json
└── CLAUDE.md                      # Project instructions for Claude Code
```

---

## Non-Goals (v1)

- No web UI or dashboard
- No Saga / distributed transaction pattern (git worktrees are the isolation mechanism)
- No MQTT (file-based communication only)
- No GitHub Copilot CLI adapter (interactive-only, no headless mode)
- No nested teams or team-of-teams
- No A2A protocol compliance (evaluated for v2)
- No smart task assignment (round-robin only)
