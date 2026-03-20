# Multi-Agent Orchestrator — v1 Autonomous CLI

> **Branch:** `archive/v1-autonomous-cli`
> **Status:** Infrastructure verified (141 tests, 140 pass), end-to-end run pending — see `VERIFICATION_REPORT.md`
> **Purpose:** Preserved autonomous CLI orchestrator. Phase 3 (chat-driven model) lives on `master`.

---

## What This Is

A Node.js orchestrator that coordinates multiple AI coding CLI agents (Claude Code, Gemini CLI) as a development team. You give it a goal in natural language; it decomposes the work, assigns tasks to agents based on their capabilities, executes in parallel with dependency awareness, and merges all results back.

**v1 model: fully autonomous.** One command, walk away, get a report.

**Phase 3 model** (on `master`): the chat window is the Tech Lead — full step-by-step control with human-in-the-loop review. v1 infrastructure is fully reused.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  User / Terminal                     │
│     node src/orchestrator/index.js "your goal"      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   Orchestrator                       │
│                                                      │
│  1. decomposeTasks()  — planner agent breaks down    │
│                         prompt into typed task list  │
│  2. assignTasks()     — capability routing +         │
│                         round-robin fallback         │
│  3. executeTasks()    — wave-based parallel exec     │
│                         with dispatched Set guard    │
│  4. monitorUntilComplete() — stale claim recovery   │
│  5. mergeAll()        — git branch integration       │
│  6. generateReport()  — audit trail + summary        │
└───────┬──────────────────────┬───────────────────────┘
        │                      │
        ▼                      ▼
┌───────────────┐    ┌─────────────────┐
│ ClaudeCode    │    │ Gemini          │
│ Adapter       │    │ Adapter         │
│               │    │                 │
│ claude -p     │    │ gemini -p       │
│ --output-     │    │ --output-format │
│ format json   │    │ json --yolo     │
│ --no-session- │    │                 │
│ persistence   │    │                 │
└───────┬───────┘    └────────┬────────┘
        │                     │
        └──────────┬──────────┘
                   ▼
┌─────────────────────────────────────────────────────┐
│              Shared Infrastructure                   │
│                                                      │
│  TaskManager      tasks.json + file locking          │
│  FileCommChannel  inbox-based agent messaging        │
│  ResultMerger     git worktree merge + reporting     │
│  Types            shared schemas + state machine     │
└─────────────────────────────────────────────────────┘

Runtime state (gitignored):
  .agent-team/
    tasks.json       ← live task list with locking
    results/         ← per-task result JSON
    report.json      ← final run report
  .worktrees/        ← isolated git worktrees per agent
```

### Source Layout

```
src/
  adapters/
    base.js           AgentAdapter base class
    claude-code.js    Claude Code CLI adapter
    gemini.js         Gemini CLI adapter
    check.js          CLI availability checker
  taskmanager/
    index.js          Task state machine + file locking
  comms/
    channel.js        CommChannel interface
    file-channel.js   File-based inbox/outbox
  merger/
    index.js          Git merge + conflict detection + report
  orchestrator/
    index.js          Main pipeline + CLI entry point
  types/
    index.js          JSDoc typedefs, state machine constants

tests/
  integration/        Real CLI tests (skip-guarded)
    helpers.js
    adapter.integration.test.js
    taskmanager.integration.test.js
```

---

## Task State Machine

```
pending ──► claimed ──► in_progress ──► done
               │                  └──► failed ──► pending (retry ≤ max_retries)
               └──► pending (unclaim)
```

Tasks with `depends_on` that fail cascade: dependents are immediately marked `failed` without executing.

---

## Capability-Based Agent Routing

| Agent | Capabilities | CLI flags |
|-------|-------------|-----------|
| `claude-code` | `code` `refactor` `test` `review` `debug` | `--output-format json --no-session-persistence` |
| `gemini` | `research` `docs` `analysis` `code` `test` | `--output-format json --yolo` |

`assignTasks()` matches task `type` to the first capable adapter. Falls back to round-robin for unknown types or tasks with no `type`.

Task types: `code` `refactor` `test` `review` `debug` `research` `docs` `analysis`

---

## Adapter Output Schemas (validated against real CLI invocations)

**Claude Code** (`--output-format json`):
```json
{ "type": "result", "is_error": false, "result": "response text", "duration_ms": 1139 }
```
Status determined by `is_error`. Text from `result` field.

**Gemini** (`--output-format json`):
```json
{ "session_id": "...", "response": "response text", "stats": { "models": { ... } } }
```
Text from `response` field. No native error field — failures surface as exceptions.

`filesChanged` is detected via `git diff --name-only HEAD` in the worktree post-execution (not from CLI JSON output).

---

## Setup

### Prerequisites

- Node.js 18+
- Git 2.5+ (worktree support)
- `claude` CLI — `npm i -g @anthropic-ai/claude-code` then authenticate
- `gemini` CLI — `npm i -g @google/gemini-cli` then authenticate

### Install

```bash
git clone https://github.com/srinjoychak/multi-agent-orchestrator
cd multi-agent-orchestrator
git checkout archive/v1-autonomous-cli
# no npm install needed — zero dependencies, Node.js built-ins only
```

### Verify CLIs

```bash
npm run orchestrate:check
```

---

## Usage

### Natural language prompt

```bash
npm run orchestrate "Build a REST API with JWT auth and unit tests"
# or
node src/orchestrator/index.js "Build a REST API with JWT auth and unit tests"
```

### Pre-defined tasks file

```bash
node src/orchestrator/index.js --tasks my-tasks.json
```

**tasks.json format:**
```json
[
  {
    "id": "T1",
    "title": "Scaffold Express app",
    "description": "Create src/app.js with Express setup and route structure",
    "type": "code",
    "depends_on": []
  },
  {
    "id": "T2",
    "title": "Add JWT middleware",
    "description": "Create src/middleware/auth.js with JWT verify logic",
    "type": "code",
    "depends_on": ["T1"]
  },
  {
    "id": "T3",
    "title": "Write auth tests",
    "description": "Create tests/auth.test.js covering valid/expired/missing token",
    "type": "test",
    "depends_on": ["T2"]
  }
]
```

### Other commands

```bash
node src/orchestrator/index.js --version        # v0.1.0
node src/orchestrator/index.js --check-agents   # probe CLIs
node src/orchestrator/index.js --help
```

### npm scripts

```bash
npm run orchestrate           # run with a prompt
npm run orchestrate:check     # check agent availability
npm test                      # all tests (unit + integration)
npm run test:unit             # unit tests only
npm run test:integration      # integration tests (requires CLIs)
```

---

## Known Limitations

1. **End-to-end not production-verified** — all unit and integration tests pass; full autonomous run with a real prompt is pending. See `VERIFICATION_REPORT.md`.
2. **Conflict resolution is manual** — merge conflicts are detected and reported, not resolved.
3. **No human-in-the-loop** — fully autonomous; there is no pause point to review the task plan before execution.
4. **Planner always uses first adapter** — `decomposeTasks()` picks the first registered adapter (claude-code). Not configurable.
5. **Shared capabilities cause routing bias** — both agents have `code` and `test`; claude-code is registered first so it always wins those types.
6. **No session recovery** — mid-run crashes leave worktrees open. `resetStaleClaims()` recovers task state after 10 min but does not recover worktree output.

---

## Test Suite

```
141 tests | 140 pass | 1 skip
```

```bash
npm test
```

| Module | Tests |
|--------|-------|
| TaskManager | State machine, locking, retry, stale claims, dependency blocking |
| FileCommChannel | Send, receive, peek, broadcast, subscribe, consume-once |
| Types | createTask defaults, isValidTransition, VALID_TRANSITIONS |
| AgentAdapter (base) | isAvailable, execute, timeout handling, error handling |
| ClaudeCodeAdapter | buildArgs, parseOutput (all JSON shapes), is_error detection |
| GeminiAdapter | buildArgs, parseOutput, newline-delimited JSON, fallback |
| ResultMerger | collectResults, mergeBranch, mergeAll, conflict detection, report |
| Orchestrator | initialize, decompose, capability routing (5 cases), wave execution, review, loadTasksFromFile |
| Integration | Real CLI invocations, full TaskManager lifecycle (skip-guarded) |

---

## How This Was Built

Developed collaboratively by **Claude Sonnet 4.6** (Tech Lead) and **Gemini CLI** (Dev Agent):

| PR | What landed | Authors |
|----|-------------|---------|
| #1 | Core scaffold: TaskManager, FileCommChannel, Types — 80 tests | Claude |
| #2 | Real CLI schema validation, adapter fixes, dependency orchestration, full test suite — 129 tests | Claude + Gemini |
| #3 | Phase 1 fixes: resultsDir init, stale claim wiring, dispatch dedup, safe error handling — 135 tests | Gemini / Claude review |
| #4 | Phase 2 quality: capability routing, enriched decomposition prompt, DX polish — 141 tests | Gemini / Claude review |

Full decision log: `DEVELOPMENT_HISTORY.md`

---

## What Comes Next — Phase 3

Phase 3 (on `master`) changes the interface model:

- **Chat session = Tech Lead** — Claude Code (or any AI CLI) drives orchestration step-by-step from the chat window
- **Discrete verbs** — `decompose`, `assign`, `execute`, `accept`, `reject`, `merge`, `status`
- **Review loop** — Tech Lead reads each result inline, accepts or reinvokes agent with feedback
- **`agents.json`** — role config replaces hardcoded capabilities; swappable per project
- **Gateway-agnostic** — tomorrow the driver can be Gemini CLI, Copilot, Codex — same infrastructure

All v1 infrastructure (adapters, TaskManager, merger, comms) is reused unchanged.

---

## License

MIT
