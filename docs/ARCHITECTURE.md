# Architecture

Technical deep-dive into the Multi-Agent Orchestrator internals.

---

## System Overview

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

### Component responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| Orchestrator | `src/orchestrator/index.js` | Entry point, pipeline coordinator. Does not execute AI work itself. |
| TaskManager | `src/taskmanager/index.js` | CRUD on the shared `tasks.json` with locking and state-machine enforcement |
| AgentAdapter base | `src/adapters/base.js` | Shared subprocess execution, timeout, abort logic |
| ClaudeCodeAdapter | `src/adapters/claude-code.js` | Claude-specific prompt format and output parsing |
| GeminiAdapter | `src/adapters/gemini.js` | Gemini-specific prompt format and output parsing (handles both single-JSON and NDJSON modes) |
| CommChannel | `src/comms/channel.js` | Abstract interface for inter-agent messaging |
| FileCommChannel | `src/comms/file-channel.js` | File-system implementation of CommChannel |
| ResultMerger | `src/merger/index.js` | Git merge, conflict detection, report generation |
| Types | `src/types/index.js` | Shared schemas, constants, state-machine table, `createTask()` factory |

---

## Task Lifecycle

Every task moves through a strict state machine enforced by `TaskManager.updateStatus()`. Invalid transitions throw an error rather than silently corrupting state.

```
                         ┌──────────────────────────────────┐
                         │                                  │
                         ▼                                  │
  ┌─────────┐      ┌──────────┐      ┌─────────────┐       │
  │ pending ├─────►│ claimed  ├─────►│ in_progress │       │
  └─────────┘      └──────────┘      └──────┬──────┘       │
       ▲                │                    │              │
       │                │ unclaim            ├──► done      │
       │                │ (timeout)          │              │
       │                ▼                    ├──► failed ───┘
       │           ┌─────────┐               │   (retry:
       └───────────│ pending │               │    retries < max_retries)
                   └─────────┘               │
                                             └──► failed (terminal:
                                                   retries >= max_retries)
```

### State definitions

| Status | Meaning |
|--------|---------|
| `pending` | Created, unassigned, eligible for claiming |
| `claimed` | Reserved by an agent (`claimed_at` set); not yet executing. Reverts to `pending` after 10 minutes (stale claim guard). |
| `in_progress` | Agent is actively executing the task in its worktree |
| `done` | Task completed successfully; `result_ref` and `completed_at` set |
| `failed` | Task failed. If `retries < max_retries` (default: 1 retry), auto-resets to `pending`. Otherwise terminal. |

### Dependency blocking

Tasks with a `depends_on` array cannot be claimed until all listed dependency task IDs are in `done` status. `TaskManager.claimTask()` checks this before writing the claim.

---

## Communication Protocol (File-Based IPC)

In v1, all inter-agent messages are JSON files written to inbox directories.

### Directory layout

```
.agent-team/
├── tasks.json              # Shared task list (locked on write)
├── tasks.lock              # Lock sentinel file (contains PID)
├── session-log.json        # Structured run log
├── report.json             # Final report written after merge
├── inbox/
│   ├── orchestrator/       # Messages to the orchestrator
│   │   └── <timestamp>-<uuid8>.json
│   ├── claude-code/        # Messages to Claude Code adapter
│   │   └── <timestamp>-<uuid8>.json
│   └── gemini/             # Messages to Gemini adapter
│       └── <timestamp>-<uuid8>.json
└── results/
    ├── T1.json             # Result from task T1
    └── T2.json             # Result from task T2
```

### Message format

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "from": "orchestrator",
  "to": "claude-code",
  "type": "task_assigned",
  "payload": { "task_id": "T1" },
  "timestamp": "2026-03-19T10:30:00.000Z"
}
```

**Message types** (`MSG_TYPES` in `src/types/index.js`):

| Type | Purpose |
|------|---------|
| `task_assigned` | Orchestrator notifies agent of task |
| `task_update` | Agent reports progress |
| `finding` | Agent shares a discovery (for inter-agent collaboration) |
| `question` | Agent asks orchestrator or peer for clarification |
| `response` | Reply to a question |
| `shutdown` | Graceful shutdown signal |
| `heartbeat` | Liveness ping |

### Receive semantics

`FileCommChannel.receive()` is **consume-once**: messages are deleted from the inbox after reading. `peek()` is available for non-destructive reads.

### Polling vs. watching

v1 uses `setInterval`-based polling in `subscribe()` rather than `fs.watch` / `chokidar`, prioritizing simplicity and portability (particularly on Windows where `fs.watch` has edge cases).

---

## Git Worktree Isolation Strategy

Each task runs in a physically separate working directory. This is the core isolation mechanism — it replaces the need for distributed transactions (Saga pattern) by giving each agent its own copy of the file tree.

### Worktree creation

```js
// Orchestrator creates worktrees before task execution
git worktree add .worktrees/claude-code-T1 -b agent/claude-code/T1
git worktree add .worktrees/gemini-T2      -b agent/gemini/T2
```

Branch naming convention: `agent/{agent-name}/{task-id}`

Path naming convention: `.worktrees/{agent-name}-{task-id}`

### Why worktrees instead of branches alone

Without worktrees, all agents share the same physical working directory. On different branches, a `git checkout` by one agent would discard uncommitted work by another. Worktrees give each agent a private filesystem view of the repo — they see the same git history but have independent working trees and index files.

### Post-execution merge

The merger attempts a `git merge --no-ff` for each completed branch in sequence:

```
for each task with status=done and worktree_branch set:
  git merge --no-ff agent/{agent}/{task-id}
  if CONFLICT detected:
    git merge --abort
    record conflict in report
  else:
    record as merged
```

Non-fast-forward merges (`--no-ff`) preserve the branch history in the commit graph, making it easy to see which agent produced which changes.

**Conflicts are never silently overwritten.** When a conflict is detected, the merge is aborted and the conflicting files are listed in the report for manual resolution.

### Cleanup

After the merge step, `ResultMerger.cleanupWorktree()` runs `git worktree remove --force` and `git branch -D` for each completed task, leaving the repo in a clean state.

---

## Concurrency and Locking

### Task claim race condition

Multiple agents could attempt to claim the same `pending` task simultaneously. The lock protocol:

1. Check for `.agent-team/tasks.lock`
2. If it exists and is under 30 seconds old: wait 100ms and retry (up to 10 attempts)
3. If it exists and is over 30 seconds old: treat as stale, delete it, and proceed
4. Write `tasks.lock` containing the current PID
5. Read `tasks.json`, mutate, write back
6. Delete `tasks.lock`

This is a simple mutex implementation suitable for single-machine use. For multi-machine scenarios (v2), the `proper-lockfile` package or a database-backed lock would replace this.

### Parallel execution

Tasks run concurrently via `Promise.all()` in the orchestrator's `executeTasks()` method. Each adapter invocation is fully independent — adapters share no mutable in-process state, and all shared state (tasks.json) goes through the lock.

### Task timeout

Each adapter receives a `timeoutMs` option (default: 5 minutes) passed through to `execFile`. When the timeout fires:

- The child process is killed (signal `SIGKILL` via Node's `error.killed`)
- The adapter's `execute()` catches the error and returns `{ status: 'failed', summary: "timed out after Xms", ... }`
- The orchestrator updates task status to `failed`, triggering the retry logic

---

## Error Handling and Retry Logic

### At the adapter layer

`AgentAdapter.execute()` wraps the `execFile` call in a try/catch. Both `error.killed` (timeout) and general subprocess errors produce a `TaskResult` with `status: 'failed'` rather than throwing. This means the orchestrator always receives a structured result, never an unhandled rejection from an adapter.

### At the task layer

`TaskManager.updateStatus(id, 'failed')` automatically resets a task to `pending` if `task.retries < task.max_retries` (default `max_retries = 1`, so each task gets one retry). The retry counter increments on each reset. Once `retries >= max_retries`, the `failed` status is terminal.

### At the orchestrator layer

If the orchestrator cannot assign a task (e.g., lock contention), the error is logged but the orchestrator continues processing other tasks. Failed assignments remain in `pending` status and are visible in the final report.

### Stale claim recovery

`TaskManager.resetStaleClaims()` resets tasks stuck in `claimed` status for more than 10 minutes back to `pending`. This handles adapter processes that crash before transitioning to `in_progress`.

---

## Future: MQTT Migration Path

The `CommChannel` abstract class in `src/comms/channel.js` defines four methods: `send`, `receive`, `broadcast`, `subscribe`. The `FileCommChannel` in `src/comms/file-channel.js` is a concrete implementation.

To migrate to MQTT in v2:

1. Create `src/comms/mqtt-channel.js` implementing the same four methods using an MQTT client (e.g., `mqtt.js`)
2. Change one line in `src/orchestrator/index.js`:
   ```js
   // Before:
   this.comms = new FileCommChannel(this.agentTeamDir);
   // After:
   this.comms = new MqttCommChannel({ brokerUrl: 'mqtt://localhost:1883', teamId: 'team-1' });
   ```
3. No changes to the orchestrator logic, adapters, or task manager

The orchestrator and all adapters are fully decoupled from the transport — they call `this.comms.send(...)` and `this.comms.receive(...)` without knowing whether the underlying transport is files, MQTT, or anything else.

### Planned MQTT topic structure (v2)

```
team/{team-id}/tasks/created       # leader publishes new tasks
team/{team-id}/tasks/claimed       # agent publishes claim
team/{team-id}/tasks/status        # status updates (in_progress / done / failed)
team/{team-id}/agent/{name}/inbox  # directed messages to a specific agent
team/{team-id}/broadcast           # all agents subscribe
team/{team-id}/heartbeat           # QoS 1, retain=true — agent liveness
```

MQTT Last Will and Testament (LWT) provides automatic "agent offline" notification on crash, replacing the manual stale-claim cleanup that exists in the v1 file-based implementation.

---

## Future: A2A Protocol

Google's Agent-to-Agent (A2A) protocol defines a standard HTTP + SSE interface for inter-agent communication, with Agent Cards for capability discovery. The current file-based and planned MQTT transport would be replaced by A2A for cross-organization or enterprise scenarios. The `CommChannel` abstraction is the insertion point — `A2aCommChannel` would implement the same four-method interface while using HTTP/SSE under the hood.
