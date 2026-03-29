# VN-Squad (Vendor-Neutral Squad)

**Run Claude Code, Gemini CLI, and Codex as a parallel engineering team — coordinated by a Tech Lead through MCP tools, with Docker-isolated execution, git worktree branching, and a SQLite state machine.**

---

## What It Is

While many tools now support "subagents," they typically operate in a single shared workspace, leading to "context bleed," conflicting file edits, and host environment contamination. **VN-Squad** matures the subagent pattern into a professional engineering workflow. 

It treats every task and sub-task as a first-class engineering unit. A Tech Lead (you, via Claude Code or Gemini CLI) dispatches work to specialized agents. Each agent is physically isolated in its own **Docker container** and logically isolated in its own **Git worktree**.

### Why VN-Squad is Better Than a "Simple Subagent"

| Feature | Simple Subagents | **VN-Squad** |
|---------|------------------|--------------|
| **Execution Space** | Shared Host (risky) | **Isolated Docker Container** |
| **Workspace** | Shared Folder (conflicts) | **Dedicated Git Worktree** |
| **Context** | Sequential/Shared | **True Multi-Vendor Parallelism** |
| **Review Loop** | "Trust me" auto-merges | **Manual Diff -> Accept/Reject/Retry** |
| **State Sync** | Fragile (chat-based) | **Auto-commit + Branch-from-HEAD** |
| **Vendor Neutrality** | Mono-model (usually) | **Mix Claude, Gemini, & Codex** |

---

### Key capabilities

- **Infrastructure Isolation** — Agents never "step on each other's toes" because they work in separate containers and branches.
- **Vendor-Neutrality** — Use Gemini for massive context research, Claude for complex logic, and Codex for rapid refactoring in a single job.
- **Delegation with Conflict Detection** — Mid-execution sub-tasking with automated parent auto-commits and child branching from HEAD.
- **The "Tech Lead" Lifecycle** — Decompose -> Route -> Execute -> Review -> Merge. 
- **Stateful Resilience** — A SQLite state machine handles retries with exponential backoff and excludes failing agents from the next attempt.

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│              Tech Lead (Claude Code / Gemini CLI)          │
│         orchestrate · delegate · diff · accept · reject    │
└─────────────────────────┬─────────────────────────────────┘
                          │  MCP over stdio (JSON-RPC 2.0)
┌─────────────────────────▼─────────────────────────────────┐
│                  VN-Squad Orchestrator                      │
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

## Quick Start

VN-Squad is a Node.js-based MCP server. All worker dependencies are containerized, so **no Python virtual environment (`venv`) is required** on the host.

### 1. Prerequisites

- **Node.js 20+**
- **Git 2.5+** (required for worktree support)
- **Docker** (must be running on the host)
- **AI CLIs** (at least one must be authenticated on the host):
  - **Claude Code**: `npm i -g @anthropic-ai/claude-code` then run `claude` to login.
  - **Gemini CLI**: `npm i -g @google/gemini-cli` then run `gemini` to login.
  - **Codex CLI**: `npm i -g @openai/codex` then run `codex` to login.

### 2. Install

```bash
git clone <this-repo>
cd vn-squad
npm install
```

### 3. Build Worker Images

Workers run in isolated containers. Build the images once:

```bash
npm run build:workers
```

### 4. Configure Your Tech Lead (MCP)

VN-Squad exposes its capabilities via the Model Context Protocol (MCP). Add it to your Tech Lead's configuration file:

#### For Claude Code (`~/.claude.json` or equivalent):
```json
{
  "mcpServers": {
    "vn-squad": {
      "command": "node",
      "args": ["/absolute/path/to/vn-squad/src/mcp-server/index.js"]
    }
  }
}
```

#### For Gemini CLI (`~/.gemini/mcp.json` or equivalent):
```json
{
  "mcpServers": {
    "vn-squad": {
      "command": "node",
      "args": ["/absolute/path/to/vn-squad/src/mcp-server/index.js"]
    }
  }
}
```

---

## Typical Workflow

Once configured, you don't run VN-Squad directly. You interact with it **through your Tech Lead** (Claude or Gemini).

### Step-by-Step Usage

1. **Start a Feature**:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. **Initialize VN-Squad**:
   In your Claude/Gemini session, clear any old state:
   `tool_use orchestrator:task_reset()`
3. **Dispatch Work**:
   `tool_use orchestrator:orchestrate(prompt: "Implement a robust JWT auth middleware with unit tests")`
4. **Monitor Progress**:
   Check the task board: `tool_use orchestrator:task_status()`
   Check active containers: `tool_use orchestrator:workforce_status()`
5. **Review and Merge**:
   For every completed task:
   - `tool_use orchestrator:task_diff(id: "T1")` (Read the diff!)
   - `tool_use orchestrator:task_accept(id: "T1")` (Merge if good)
   - `tool_use orchestrator:task_reject(id: "T1", reason: "Missing error handling")` (Re-queue if not)

---

## MCP Tools (The "Tech Lead" Command Set)

12 tools exposed over MCP:

| Tool | Arguments | Description |
|------|-----------|-------------|
| `orchestrate` | `prompt` | Full pipeline: decompose → assign → execute. Blocks until all tasks complete. |
| `delegate` | `subagent_name`, `prompt`, `type?`, `parent_task_id?` | Hand off a sub-task mid-execution. Child branches from parent's HEAD. |
| `list_subagents` | — | Show configured agents, capabilities, and quotas. |
| `task_status` | `id?`, `subagent_name?` | Query task board by ID or subagent role. |
| `task_diff` | `id` | Get the git diff of a completed task. **Mandatory before accepting.** |
| `task_accept` | `id` | Merge the task branch and remove the worktree. |
| `task_reject` | `id`, `reason` | Re-queue a task with feedback; excludes the failing agent on retry. |
| `task_discard` | `id` | Permanently fail a task without merging. |
| `task_logs` | `id`, `tail?` | Stream container logs. |
| `task_kill` | `id` | Force-stop a hanging agent container. |
| `workforce_status` | — | Summary of running containers and overall job progress. |
| `task_reset` | — | Clear the SQLite database. Use this before starting a new job. |

---

## System Compatibility

- **Developed and Tested on**: WSL2 (Ubuntu 22.04+).
- **macOS**: Testing and validation pending. Docker and Git Worktree behavior may require minor adjustments for macOS file system case-sensitivity.
- **Windows (Native)**: Not recommended. Use WSL2 for best performance and compatibility with Docker bind-mounts.

---

## Contributing

1. `npm install`
2. Build worker images: `npm run build:workers`
3. Keep ES module syntax (`.js` extensions on all imports)
4. All task state mutations must go through `TaskManager`.
5. `npm test` → 0 failures required for all PRs.

---

## License

MIT
