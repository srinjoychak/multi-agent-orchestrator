# Development Plan — Multi-Agent Orchestrator POC v1

## Objective

Build a working POC that coordinates Claude Code and Gemini CLI as teammates,
working on tasks in parallel via isolated git worktrees, communicating through
a file-based message protocol, managed by a Node.js orchestrator.

---

## Development Strategy

**We will develop this project using Claude Code Agent Teams itself.**

Agent teams are enabled for this workspace via `.claude/settings.local.json`.
The development team structure:

- **Lead**: Architecture, orchestrator core, integration testing
- **Teammate 1**: Adapter layer (base class + Claude Code adapter + Gemini adapter)
- **Teammate 2**: Task manager + communication layer + merger

---

## Sprint Plan

### Sprint 0 — Foundation (Day 1)

| # | Task | Description | Status |
|---|------|-------------|--------|
| S0-1 | Project scaffolding | `npm init`, install dependencies, configure ESLint | Pending |
| S0-2 | Type definitions | Define Task, TaskResult, AgentMessage, TaskContext schemas | Pending |
| S0-3 | Git repo init | Initialize git repo, set up .gitignore for .agent-team/, .worktrees/ | Pending |
| S0-4 | CLAUDE.md | Write project instructions so agent teammates understand the codebase | Pending |

**Dependencies**: package.json (npm install)
```
proper-lockfile     — file-based locking for task claims
chokidar            — cross-platform file watching
chalk               — terminal output formatting
uuid                — message IDs
commander           — CLI argument parsing
```

### Sprint 1 — Task Manager (Day 1-2)

| # | Task | Description | Status |
|---|------|-------------|--------|
| S1-1 | Task schema validation | JSON schema for tasks.json, validate on read/write | Pending |
| S1-2 | Task CRUD operations | create, read, update, delete tasks in tasks.json | Pending |
| S1-3 | Task state machine | Enforce valid transitions (pending→claimed→in_progress→done/failed) | Pending |
| S1-4 | File locking | Implement lock/unlock around tasks.json mutations | Pending |
| S1-5 | Task claiming | Agent claims a task by ID — atomic claim with lock | Pending |
| S1-6 | Dependency resolution | Block tasks whose depends_on are not all "done" | Pending |
| S1-7 | Unit tests | Test state transitions, locking, concurrent claims | Pending |

**Acceptance Criteria**:
- Two processes can safely claim different tasks without corruption
- Invalid state transitions throw errors
- Blocked tasks cannot be claimed

### Sprint 2 — Communication Layer (Day 2-3)

| # | Task | Description | Status |
|---|------|-------------|--------|
| S2-1 | CommChannel interface | Abstract base class with send/receive/broadcast/subscribe | Pending |
| S2-2 | FileCommChannel | File-based implementation using inbox directories | Pending |
| S2-3 | Message schema | Define AgentMessage format with validation | Pending |
| S2-4 | File watcher | chokidar-based watcher on inbox directories | Pending |
| S2-5 | Message ordering | Timestamp-based ordering for inbox reads | Pending |
| S2-6 | Unit tests | Test send/receive, broadcast, ordering | Pending |

**Acceptance Criteria**:
- Agent A can send a message to Agent B via file system
- Broadcast reaches all agents
- Messages are read in timestamp order

### Sprint 3 — Adapter Layer (Day 3-4)

| # | Task | Description | Status |
|---|------|-------------|--------|
| S3-1 | Base adapter class | Abstract AgentAdapter with lifecycle hooks | Pending |
| S3-2 | CLI detection | `isAvailable()` — check if claude/gemini CLI exists in PATH | Pending |
| S3-3 | Claude Code adapter | Spawn `claude -p` with structured prompt, parse JSON output | Pending |
| S3-4 | Gemini adapter | Spawn `gemini -p` with structured prompt, parse JSON output | Pending |
| S3-5 | Worktree management | Create/cleanup git worktrees per task per agent | Pending |
| S3-6 | Timeout handling | Kill agent process after configurable timeout | Pending |
| S3-7 | Output capture | Capture stdout/stderr, write to result file | Pending |
| S3-8 | Integration tests | Run each adapter on a simple "create a file" task | Pending |

**Acceptance Criteria**:
- Claude Code adapter can execute a prompt and return structured result
- Gemini adapter can execute a prompt and return structured result
- Each works in its own git worktree
- Timeout kills the process and marks task as failed

### Sprint 4 — Orchestrator (Day 4-5)

| # | Task | Description | Status |
|---|------|-------------|--------|
| S4-1 | CLI entry point | `node orchestrator.js "user prompt"` — parse args | Pending |
| S4-2 | Task decomposition | Use Claude Code (via adapter) to break user prompt into tasks | Pending |
| S4-3 | Task assignment | Round-robin assignment of tasks to available adapters | Pending |
| S4-4 | Parallel execution | Spawn adapter processes, run tasks concurrently | Pending |
| S4-5 | Progress monitoring | Watch task status changes, log progress | Pending |
| S4-6 | Failure handling | Detect failed tasks, retry once, then report | Pending |
| S4-7 | Session log | Write structured log to .agent-team/session-log.json | Pending |
| S4-8 | Integration test | End-to-end: prompt → decompose → assign → execute → results | Pending |

**Acceptance Criteria**:
- User provides a prompt, orchestrator decomposes into tasks
- Tasks are assigned to Claude Code and Gemini adapters
- Both run in parallel in separate worktrees
- Orchestrator reports when all tasks complete

### Sprint 5 — Merger & Polish (Day 5-6)

| # | Task | Description | Status |
|---|------|-------------|--------|
| S5-1 | Result collection | Gather all result files from .agent-team/results/ | Pending |
| S5-2 | Git merge | Merge agent branches back to main, detect conflicts | Pending |
| S5-3 | Conflict report | Generate human-readable conflict report | Pending |
| S5-4 | Summary generation | Aggregate findings into final summary | Pending |
| S5-5 | Worktree cleanup | Remove worktrees and temp branches after merge | Pending |
| S5-6 | End-to-end test | Full pipeline: prompt → tasks → execute → merge → summary | Pending |

**Acceptance Criteria**:
- Agent branches merge cleanly when they touch different files
- Conflicts are detected and reported (not silently overwritten)
- Worktrees are cleaned up after merge

---

## Key Design Decisions

### Why file-based communication (not HTTP/WebSocket)?

1. Zero infrastructure — no server to run
2. Survives agent crashes — messages persist on disk
3. Debuggable — `cat .agent-team/inbox/gemini/*.json`
4. Natural fit for CLI tools that already work with files
5. Easily replaced with MQTT later via CommChannel interface

### Why git worktrees (not branches alone)?

Worktrees give each agent a physically separate working directory. Without worktrees,
agents would fight over the same files on disk even on different branches. Worktrees
are the "isolation boundary" — they replace the need for Saga-style distributed
transactions.

### Why round-robin task assignment?

For v1, simplicity wins. Smart assignment (matching task type to agent strengths)
requires profiling each agent's capabilities, which is v2 work. Round-robin ensures
both agents get work and we validate the full pipeline.

### Why use Claude Code for task decomposition?

The orchestrator needs to break a natural language prompt into structured tasks.
Rather than building a custom NLP layer, we use Claude Code itself (via its adapter)
for this one-time planning step. This is a "bootstrap" — the orchestrator uses one
agent to plan, then all agents to execute.

---

## v2 Roadmap (Post-POC)

| Feature | Description |
|---------|-------------|
| MQTT transport | Swap FileCommChannel for MqttCommChannel (Mosquitto) |
| GitHub Copilot adapter | If/when Copilot CLI gets headless mode |
| OpenAI Codex adapter | `codex` CLI integration |
| Smart assignment | Profile agent strengths, match tasks to best agent |
| A2A protocol | Implement Google's Agent-to-Agent protocol for interop |
| Web dashboard | Real-time task board (like a mini Jira) |
| CI/CD integration | Run as a GitHub Action / pipeline step |
| Inter-agent debate | Agents review each other's work before merge |
| Task prioritization | User sets priority, agents pick highest-priority first |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemini CLI output format changes | Adapter breaks | Pin CLI version, add output validation |
| Git merge conflicts | Manual resolution needed | Assign non-overlapping files per agent |
| Agent hangs indefinitely | Blocks pipeline | Timeout + process kill in adapter |
| File lock contention | Task claim fails | Retry with backoff (3 attempts) |
| Claude Code API rate limits | Adapter fails | Exponential backoff, retry logic |
| Large repo worktree creation slow | Slow startup | Use shallow worktrees, warm cache |
