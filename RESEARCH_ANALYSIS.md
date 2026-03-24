# Research & Analysis -- Multi-Agent Orchestrator

**Last Updated:** 2026-03-24

---

## 1. What We're Building and Why It Matters

### The Core Idea

A multi-agent orchestration layer that sits between a human engineer and multiple AI coding
CLIs. Instead of switching between Claude Code and Gemini CLI manually, a Tech Lead agent
(any MCP-capable chat) decomposes work, dispatches subtasks to worker agents in Docker
containers with isolated git worktrees, reviews output, and merges accepted results.

### Why This Has Value

**Parallel execution.** Multiple agents working simultaneously on independent subtasks can cut
wall-clock time by 40-60% on tasks that decompose cleanly.

**Token optimization.** Route commodity tasks (docs, research, boilerplate) to free-tier agents
(Gemini). Reserve premium agents (Claude) for precision work. Track token usage per task to
inform future routing. This is the primary value driver.

**Specialization routing.** Gemini excels at research, documentation, and broad analysis.
Claude Code excels at precise refactoring, debugging, and test authorship.

**Cost arbitrage.** Gemini CLI (free tier) effectively costs $0 per task. Claude Code scales
with usage. Routing 70% of commodity tasks to Gemini reduces cost dramatically.

**Auditability.** Each task executes in an isolated git worktree on its own branch. The diff
is reviewable before merge. Failed or rejected tasks leave no trace in the main branch.

---

## 2. Competitive Landscape (updated 2026-03-24)

### Direct Competitors

| Tool | Approach | Our Advantage |
|---|---|---|
| parallel-code | Desktop app, each agent gets worktree/branch | No task decomposition, no smart routing, no MCP |
| Composio Agent Orchestrator | Fleet management, worktrees, auto-PR, CI fix | Cloud-focused, not local-first, no MCP-native |
| Superset | IDE for orchestrating Claude/Codex | GUI-focused, not MCP-native, tied to their IDE |
| Overstory | Multi-agent via tmux + SQLite mail, 11 runtimes | No Docker isolation, no token tracking |
| Mozzie | Desktop tool for parallel agent work items | Closed source, limited agent support |
| Claude Code Agent Teams | Native experimental feature (tmux panes) | Claude-only, no Gemini/Codex routing |
| Plandex | Multi-model planning + execution | API-based, not CLI-native -- no real tool access |
| Claude-Code-Workflow | JSON-driven multi-agent cadence framework | Claude-centric, no Docker isolation |

### Our Unique Differentiators

1. **MCP-native.** The orchestrator is an MCP server. Works from Claude Code, Gemini CLI,
   Cursor, VS Code -- any MCP client. No vendor lock-in on the Tech Lead side.

2. **Docker-isolated workers.** Containers provide real TTY, clean cleanup, resource limits.
   No subprocess hacks. No orphaned processes.

3. **Cross-vendor routing.** Claude, Gemini, and future agents (Codex, Aider) through the
   same interface. Route by capability and cost.

4. **Token optimization focus.** Track token usage per task, per agent. Inform routing
   decisions with real cost data. No other tool prioritizes this.

5. **Docker MCP Toolkit hosted.** The orchestrator runs in Docker MCP Toolkit -- zero
   separate infrastructure. Same place users already manage their MCP servers.

### Market Validation

The "agentmaxxing" trend (running 5-7 concurrent AI agents) is well-established as of
early 2026. Git worktrees are the consensus isolation mechanism. The practical ceiling is
5-7 agents before rate limits and review bottleneck eat the gains. Our system is designed
for this exact sweet spot.

---

## 3. v1/v2 Post-Mortem

### What Failed and Why

**v1 (CLI verbs + subprocesses) -- 2026-03-19 to 2026-03-24**

Root cause chain for Gemini CLI hangs:
1. Wrong flags (`--approval-mode=yolo` is Claude, not Gemini; use `-y`)
2. MCP_DOCKER inherits stdio pipes, keeps them open after Gemini exits
3. `spawnCollect` resolves on `exit` not `close` -- partial fix
4. **Open stdin** causes Gemini to block in interactive-wait code paths
5. `cp.kill('SIGTERM')` only kills top-level `cmd.exe`, orphans child tree

Other v1 bugs:
- CLAUDE.md overwritten when `workDir === projectRoot` during decompose
- File-based `tasks.json` with `proper-lockfile` races at 3+ agents
- No heartbeat -- hanging workers block pipeline for 900s

**v2 (MCP server + subprocesses) -- designed but never built**

Would have solved the Tech Lead interface (MCP tools instead of CLI verbs) but kept
subprocess spawning for workers. The fundamental TTY problem would have persisted.

### The Docker Solution

**Confirmed 2026-03-24:** `gemini -p "..." -y < /dev/null` completes in seconds on WSL host.
Docker `-t` flag provides equivalent TTY allocation. This eliminates 100% of the subprocess
management code that consumed the majority of v1 development time.

Docker also provides:
- Clean process cleanup (`docker rm -f` kills everything)
- Resource limits (`--memory 2g`, `--stop-timeout`)
- Auth isolation (volume mounts, not env vars)
- Platform independence (same on any OS with Docker)

### What to Preserve from v1

These components are solid and reusable:
- Task state machine logic (pending -> claimed -> in_progress -> done/failed)
- Decomposition prompt and JSON extraction
- Quota-weighted agent assignment algorithm
- Git worktree create/merge/diff/prune logic
- Claude output parsing (`--output-format json` structured response)
- Type validation (code/refactor/test/review/debug/research/docs/analysis)

---

## 4. Key Technical Findings

### Gemini CLI in Docker (2026-03-24)

- Official sandbox image `us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.1.1` is
  **stale** (v0.1.1 vs host v0.34.0). Does not support current OAuth auth format.
- Must build custom image with `@google/gemini-cli@0.34.0` from npm.
- Container user is `node` (HOME=/home/node). Auth mount target: `/home/node/.gemini`.
- `.gemini` must be mounted **read-write** (Gemini writes `user_id`, `state.json`).
- `--sandbox` flag provides Gemini's own containerized tool execution (Docker-in-Docker).

### Claude Code in Docker

- `claude --print -p "..." --output-format json` returns structured JSON with:
  - `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`
  - `files_changed` array, `result` text, `duration_ms`
- Auth via `~/.claude/.credentials.json` (OAuth, Claude Max subscription).
- Mount read-only -- Claude doesn't write to auth dir during headless execution.

### Docker MCP Toolkit

- Available in WSL via Docker Desktop integration.
- `docker mcp` CLI supports: `server add/list`, `client connect` (claude-code, gemini, + 14 others).
- Orchestrator can be registered as an MCP server and connected to both clients.
- Supports Docker socket passthrough for Docker-in-Docker pattern.

### WSL Environment

- Docker daemon is Docker Desktop backend, accessible from WSL.
- All Windows-specific code (`cmd.exe /c`, `taskkill /F /T`, ConPTY) is dead code.
- Linux process management (`kill -TERM -pgid`) is simpler and more reliable.
- Git, Node.js, both CLIs all working in WSL.

---

## 5. Principles for v3 Development

### From v1 Lessons

1. **Docker > subprocesses.** Don't fight TTY issues -- containerize.
2. **Close stdin always.** Any headless CLI: `< /dev/null` or Docker `-t`.
3. **Kill containers, not processes.** `docker stop/kill` is reliable. `SIGTERM` is not.
4. **Don't trust agent self-reports.** Check filesystem state, run tests, inspect diffs.
5. **Short feedback loops.** Test with "respond with HELLO" before complex tasks.

### For v3 Architecture

6. **Token optimization is the product.** Track, report, and route based on token cost.
7. **MCP-native everything.** The orchestrator is an MCP server. Period.
8. **Any chat can be Tech Lead.** Don't hardcode Claude. Gemini can lead too.
9. **SQLite > JSON files.** ACID guarantees matter for parallel workers.
10. **Docker MCP Toolkit is the host.** No separate infrastructure to manage.
