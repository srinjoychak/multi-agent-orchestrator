# Multi-Agent Orchestrator

**Vendor-neutral orchestrator that coordinates multiple AI coding CLIs (Claude Code, Gemini CLI) as a team — decomposing work, executing tasks in parallel git worktrees, and merging results.**

---

## Architecture

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

### First run

```bash
node src/orchestrator/index.js "Build a REST API with user authentication and unit tests"
```

---

## Usage Examples

```bash
# Decompose and implement a feature with both agents in parallel
node src/orchestrator/index.js "Add a user profile page with avatar upload and settings form"

# Security + performance audit split across agents
node src/orchestrator/index.js "Review src/ for security vulnerabilities and performance bottlenecks"

# Multi-file refactor coordinated across worktrees
node src/orchestrator/index.js "Migrate the codebase from CommonJS to ES modules"

# Check which agents are available before running
node src/orchestrator/index.js --check-agents
```

---

## How It Works

The orchestrator runs a **6-step pipeline** for every prompt:

| Step | Name | What happens |
|------|------|--------------|
| 1 | **Decompose** | The first available agent analyzes the prompt and returns a JSON array of independent tasks |
| 2 | **Assign** | Tasks are assigned to agents in round-robin order (e.g., T1 → claude-code, T2 → gemini, T3 → claude-code) |
| 3 | **Worktree** | A dedicated `git worktree` is created per task, giving each agent a physically isolated working directory on a fresh branch |
| 4 | **Execute** | All tasks run concurrently via `Promise.all`; each agent receives a structured prompt and works in its worktree |
| 5 | **Merge** | Completed branches are merged back to main with `git merge --no-ff`; conflicts are detected and reported — never silently overwritten |
| 6 | **Report** | A summary is printed to stdout and written to `.agent-team/report.json` |

---

## Configuration

Options are passed to the `Orchestrator` constructor in code, or set via environment before running:

| Option | Default | Description |
|--------|---------|-------------|
| `pollIntervalMs` | `2000` | How often (ms) the orchestrator polls task status |
| `taskTimeoutMs` | `300000` | Per-task timeout in ms (5 minutes); the agent process is killed on breach |

### Programmatic usage

```js
import { Orchestrator } from './src/orchestrator/index.js';

const orchestrator = new Orchestrator('/path/to/your/project', {
  pollIntervalMs: 5000,   // poll every 5s
  taskTimeoutMs: 600_000, // 10-minute timeout per task
});

await orchestrator.initialize();
await orchestrator.run('Your task description here');
```

### Adding agents at runtime

The orchestrator auto-detects available CLIs on startup. If both `claude` and `gemini` are in `PATH`, both adapters activate automatically. Install or remove CLIs to change the active agent pool without touching configuration files.

---

## Adding a New Adapter

See the full guide at [docs/ADDING_ADAPTERS.md](docs/ADDING_ADAPTERS.md). The short version:

1. Create `src/adapters/your-agent.js` extending `AgentAdapter`
2. Implement `buildArgs(task, context)` and `parseOutput(stdout, stderr, duration_ms)`
3. Register the adapter in `src/orchestrator/index.js`

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
| Primary focus | Task decomposition + parallel implementation | Code review aggregation | Hierarchical session management |
| Isolation mechanism | **Git worktrees** | None stated | tmux sessions |
| Language | Node.js | Node.js | Python |
| Infrastructure required | None | None | tmux 3.3+ |
| Communication layer | File-based (MQTT-ready) | Not abstracted | Session-based |
| Agents supported | Claude Code, Gemini | Claude, Codex, Gemini, OpenCode, Qwen | Kiro, Claude, Codex, Gemini, Kimi, Copilot |
| Conflict detection | Yes — git merge | N/A | N/A |
| A2A protocol roadmap | v2 | No | No |
| Stars (as of research) | — | ~215 | ~333 |

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
