# Multi-Agent Orchestrator

**Vendor-neutral orchestrator that coordinates multiple AI coding CLIs (Claude Code, Gemini CLI) as a team — decomposing work, executing tasks in parallel git worktrees, and merging results.**

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│         Tech Lead (Claude Code chat)              │
│     drives each step via CLI verbs                │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│              Orchestrator (Library)               │
│                                                   │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────┐ │
│  │  decompose   │ │    assign    │ │   merge   │ │
│  │  (plan)      │ │  (route by   │ │ (combine  │ │
│  │              │ │  capability) │ │  results) │ │
│  └─────────────┘ └──────────────┘ └───────────┘ │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │         Session State (.agent-team/)          │ │
│  │    tasks.json  session.json  results/         │ │
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

## Quick Start

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Git 2.5+** — for worktree support
- At least one AI CLI agent:
  - **Claude Code**: `npm i -g @anthropic-ai/claude-code` and authenticate
  - **Gemini CLI**: `npm i -g @google/gemini-cli` and authenticate

See [docs/SETUP.md](docs/SETUP.md) for full installation instructions.

### Install

```bash
git clone <this-repo>
cd copilot_adapter
npm install
```

### Verify agents

```bash
npm run check-agents
```

---

## Chat-Driven Mode (Phase 3) — Primary Usage

The Claude Code chat window **is the Tech Lead**. Instead of a black-box command that runs autonomously, you drive each step from your chat session:

```
Tech Lead (you) → plans → assigns → reviews → approves/rejects
Developer agents (Claude Code, Gemini) → implement → report back
```

### Step-by-step workflow

```bash
# 1. Decompose the request into discrete tasks
node src/orchestrator/index.js decompose "Build a REST API with auth and tests"

# 2. Assign tasks to agents by capability (reads agents.json)
node src/orchestrator/index.js assign

# 3. Execute tasks — all pending, or one at a time
node src/orchestrator/index.js execute
node src/orchestrator/index.js execute T1

# 4. Check progress
node src/orchestrator/index.js status

# 5. Review and accept or reject each result
node src/orchestrator/index.js accept T1
node src/orchestrator/index.js reject T2 "Missing error handling on /login"

# 6. Merge accepted branches into main
node src/orchestrator/index.js merge

# 7. Generate final summary
node src/orchestrator/index.js report
```

Rejected tasks are automatically re-queued as `pending` with the rejection reason appended to their description, so the agent gets feedback on retry.

---

## CLI Reference

| Verb | Arguments | Description |
|------|-----------|-------------|
| `decompose` | `"prompt"` | Decompose a request into tasks; saves to `.agent-team/tasks.json` |
| `assign` | — | Assign pending tasks to agents by capability (reads `agents.json`) |
| `execute` | `[taskId]` | Execute all pending tasks, or one specific task by ID |
| `status` | — | Show current session state: tasks, reviews, next action |
| `accept` | `<taskId>` | Mark a task result as accepted; eligible for merge |
| `reject` | `<taskId> "reason"` | Reject a result; re-queues task with feedback for retry |
| `merge` | `[taskId]` | Merge accepted branches into main; reports conflicts |
| `report` | — | Generate final summary report |
| `run` | `"prompt"` | Autonomous mode: decompose → assign → execute → merge in one shot |
| `--tasks` | `<file>` | Load tasks from JSON file and run autonomously |
| `--check-agents` | — | Check which AI CLI agents are available in PATH |
| `--version` | — | Print version |
| `--help` | — | Show help |

---

## Agent Configuration (`agents.json`)

Capability routing is controlled by `agents.json` at the project root:

```json
{
  "claude-code": {
    "role": "tech-lead-reviewer",
    "capabilities": ["review"],
    "weight": 1
  },
  "gemini": {
    "role": "developer",
    "capabilities": ["code", "refactor", "test", "debug", "docs", "research", "analysis"],
    "weight": 1
  }
}
```

Tasks are routed to the first agent whose `capabilities` includes the task `type`. Adjust this file to change routing without touching code.

---

## How It Works

The orchestrator runs a **step pipeline** for every prompt:

| Step | Name | What happens |
|------|------|--------------|
| 1 | **Decompose** | The first available agent analyzes the prompt and returns a JSON array of independent tasks |
| 2 | **Assign** | Tasks are routed to agents by capability match (reads `agents.json`) |
| 3 | **Worktree** | A dedicated `git worktree` is created per task on a fresh branch |
| 4 | **Execute** | Tasks run concurrently; each agent receives a structured prompt in its worktree |
| 5 | **Review** | Tech Lead accepts or rejects each result; rejected tasks are re-queued with feedback |
| 6 | **Merge** | Accepted branches are merged back to main; conflicts detected and reported |
| 7 | **Report** | Summary printed to stdout and written to `.agent-team/report.json` |

---

## Session State

All state is stored in `.agent-team/` (gitignored):

```
.agent-team/
  tasks.json       # task list (managed by TaskManager)
  session.json     # current phase, reviews, prompt
  results/         # per-task results (T1.json, T2.json, ...)
  report.json      # final merged report
```

Session phases: `decomposed → assigned → executing → reviewing → merged → complete`

---

## Autonomous Mode (v1 compat)

```bash
# Single command — runs all steps unattended
node src/orchestrator/index.js run "Build a REST API with user authentication and unit tests"

# Load tasks from a JSON file
node src/orchestrator/index.js --tasks tasks.json
```

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `pollIntervalMs` | `2000` | How often (ms) the orchestrator polls task status |
| `taskTimeoutMs` | `900000` | Per-task timeout in ms (15 minutes) |

### Programmatic usage

```js
import { Orchestrator } from './src/orchestrator/index.js';

const orchestrator = new Orchestrator('/path/to/your/project', {
  pollIntervalMs: 5000,
  taskTimeoutMs: 600_000,
});

await orchestrator.initialize();
await orchestrator.run('Your task description here');
```

---

## Adding a New Adapter

See the full guide at [docs/ADDING_ADAPTERS.md](docs/ADDING_ADAPTERS.md). The short version:

1. Create `src/adapters/your-agent.js` extending `AgentAdapter`
2. Implement `buildArgs(task, context)` and `parseOutput(stdout, stderr, duration_ms)`
3. Register the adapter in `src/orchestrator/core.js`

```js
// Minimal skeleton
import { AgentAdapter } from './base.js';

export class YourAgentAdapter extends AgentAdapter {
  constructor(options = {}) {
    super('your-agent', 'your-cli-command', options);
  }

  buildArgs(task, context) {
    return ['-p', task.description, '--output-format', 'json'];
  }

  parseOutput(stdout, stderr, duration_ms) {
    return { status: 'done', summary: stdout, filesChanged: [], output: stdout, duration_ms };
  }
}
```

---

## Comparison

| Feature | **This project** | MCO | AWS CAO |
|---------|-----------------|-----|---------|
| Primary focus | Chat-driven step orchestration | Code review aggregation | Hierarchical session management |
| Isolation mechanism | **Git worktrees** | None stated | tmux sessions |
| Language | Node.js | Node.js | Python |
| Infrastructure required | None | None | tmux 3.3+ |
| Communication layer | File-based (MQTT-ready) | Not abstracted | Session-based |
| Agents supported | Claude Code, Gemini | Claude, Codex, Gemini, OpenCode, Qwen | Kiro, Claude, Codex, Gemini, Kimi, Copilot |
| Tech Lead review loop | Yes — accept/reject/retry | No | No |
| Conflict detection | Yes — git merge | N/A | N/A |
| A2A protocol roadmap | v2 | No | No |

---

## MQTT Roadmap (v2)

The communication layer (`CommChannel`) is designed to be swapped without touching orchestrator or adapter code. The v1 file-based transport (`FileCommChannel`) will be replaced with `MqttCommChannel` (Mosquitto) in v2 when:

- Agents need to run on different machines or containers
- Real-time event streaming with sub-10ms latency is required
- Team size exceeds 5 concurrent agents

Planned MQTT topic structure:

```
team/{team-id}/tasks/created       # new tasks from leader
team/{team-id}/tasks/claimed       # agent claiming a task
team/{team-id}/tasks/status        # status updates
team/{team-id}/agent/{name}/inbox  # directed messages
team/{team-id}/broadcast           # all agents subscribe
team/{team-id}/heartbeat           # liveness (retain=true)
```

---

## Contributing

1. Fork and clone the repo
2. `npm install`
3. Run `npm run check-agents` to verify your environment
4. Make changes; keep ES module syntax (`import`/`export`)
5. Run `npm test` before submitting a PR
6. All task mutations must go through `TaskManager` — never write `tasks.json` directly
7. New adapters must implement the `AgentAdapter` interface from `src/adapters/base.js`

---

## License

MIT
