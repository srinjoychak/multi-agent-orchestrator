# Multi-Agent Orchestrator — Active Plan

_Last updated: 2026-03-23 — Claude Sonnet 4.6 (Tech Lead)_

---

## System Overview

A multi-agent orchestration system operated exclusively from a **Claude Code or Gemini CLI chat session**.
The Tech Lead (Claude Code) decomposes work, assigns tasks to agent workers (claude CLI / gemini CLI processes),
reviews their output, and merges accepted results.

```
Human → Claude Code (Tech Lead) → orchestrator CLI → agent workers (claude CLI / gemini CLI)
```

**Key constraint**: This system is NEVER operated by a human running terminal commands directly.

---

## Current State — 2026-03-23

| Item | Status |
|---|---|
| Tests | 204 pass, 0 fail, 2 skip |
| Branch | `gemini-agent-fix` (not yet merged to master) |
| Phase 4 hardening | Complete and merged (PR #6) |
| Gemini file-write bug | Fixed (see below) — awaiting e2e verification |

### Gemini Fixes Applied This Session

Three root causes fixed in `src/adapters/gemini.js`:

| # | Root Cause | Fix |
|---|---|---|
| B | `git diff --name-only HEAD` misses untracked files (newly created files in fresh worktree) | Replaced with `git status --porcelain` |
| C | `JSON.parse(lastLine)` fails on pretty-printed Gemini JSON (last line is `}`) | Replaced with 3-strategy `_tryParseJson()` |
| A/D | catch block returned `status:'done'` even for monologue/junk output | Now returns `status:'failed'` → task retries |

Also fixed in `src/orchestrator/core.js`:
- Task `type:"?"` display bug — types not in valid set are now coerced to `code`

---

## Agent Configuration

```json
// agents.json
"claude-code": { "quota": 30, "capabilities": ["code","refactor","test","debug"] }
"gemini":       { "quota": 70, "capabilities": ["research","docs","analysis","code","test"], "models": {} }
```

`"models": {}` → Gemini CLI uses its default model. Named model strings (gemini-2.5-pro etc.) caused 186s+ hangs.

---

## Responsibility Split

### Claude Code (Tech Lead) — owns these files

| File | Responsibility |
|---|---|
| `src/orchestrator/core.js` | Decompose, assign, merge logic |
| `src/orchestrator/steps/` | CLI verb implementations (decompose, assign, execute, status, accept, reject) |
| `src/adapters/claude-code.js` | Claude agent adapter |
| `src/adapters/base.js` | Base adapter lifecycle, GEMINI.md/CLAUDE.md writing |
| `src/taskmanager/` | Task state machine, locking |
| `src/types/index.js` | Shared types and createTask() |
| `platform/detect.js` | Windows/Linux/Mac exec abstraction |
| `tests/` | Integration tests |
| `PLAN.md` | This file — keep it current |
| `agents.json` | Agent capabilities + quota |

**Claude's job**: Code fixes, test coverage, PR reviews, architecture decisions, keeping PLAN.md current.
Claude reviews Gemini's output and accepts/rejects via `accept`/`reject` verbs.

### Gemini — owns these tasks

| Task Type | Examples |
|---|---|
| `docs` | Write markdown files, API docs, comparison tables |
| `research` | Investigate bugs, analyse code behaviour |
| `analysis` | Review output, summarise findings |
| `code` | Overflow when Claude is at quota |

**Gemini's job**: Execute assigned tasks inside its worktree. Write output to files using `write_file`.
Gemini reads `GEMINI.md` (auto-written to its worktree cwd) for project context.

**IMPORTANT for Gemini**: Do not read or modify files outside your assigned worktree.
When a task is complete, write a summary of what files you created or changed.
Use `write_file` immediately — do not describe a plan without writing files.

---

## Next Steps

### Immediate (this session)

- [ ] **E2E verify Gemini fix** — run orchestrator test, confirm Gemini writes a file:
  ```
  node src/orchestrator/index.js reset --hard
  node src/orchestrator/index.js decompose "Write docs/gemini-verified.md with a markdown table comparing Jest, Vitest, and Node built-in test runner across speed, zero-config setup, and TypeScript support. Use your own knowledge only."
  node src/orchestrator/index.js assign
  node src/orchestrator/index.js execute
  node src/orchestrator/index.js status
  ```
  **Pass criteria**: `status: done`, `filesChanged` includes `gemini-verified.md`, file has real content.

- [ ] **Merge `gemini-agent-fix` → master** after e2e passes

### Phase 4 Remaining (Claude)

| Task | Description |
|---|---|
| Worktree cleanup on abort | Orphaned worktrees accumulate if tasks are interrupted — prune on `reset --hard` |
| `--output-format json` compatibility | Validate Gemini + Claude output formats as CLI versions change |
| Session cleanup on new decompose | Running `decompose` twice should reset session + tasks cleanly |

### Phase 5 — MQTT Transport (future)

Replace `FileCommChannel` with `MqttCommChannel` (Mosquitto) for multi-machine agent teams.
Only start after Phase 4 is complete and Gemini reliability is confirmed.

### Phase 6 — A2A Protocol (future)

Implement Google's Agent-to-Agent (A2A) protocol for interop with other agent frameworks.
Only after Phase 5 MQTT is stable.

---

## Orchestrator Commands Reference

```bash
node src/orchestrator/index.js decompose "<request>"   # Break into tasks
node src/orchestrator/index.js assign                  # Assign to agents by capability + quota
node src/orchestrator/index.js execute [taskId]        # Run tasks (all pending or one specific)
node src/orchestrator/index.js status                  # View task results
node src/orchestrator/index.js accept <taskId>         # Approve + merge result
node src/orchestrator/index.js reject <taskId> "why"   # Reject + re-queue for retry
node src/orchestrator/index.js reset --hard            # Wipe session + worktrees, start fresh
```

---

## Key Files Quick Reference

| File | Purpose |
|---|---|
| `src/orchestrator/index.js` | CLI entry point |
| `src/adapters/gemini.js` | Gemini adapter — prompt, output parsing, file detection |
| `src/adapters/base.js` | Base adapter — execute lifecycle, context file writing |
| `src/orchestrator/core.js` | Orchestrator — worktree management, quota assignment |
| `agents.json` | Agent capabilities, quota, model overrides |
| `docs/gemini-agent-prompt-guide.md` | Why "subagent" language breaks Gemini tool access |
| `CLAUDE.md` | Claude Code project instructions (auto-loaded by Claude Code) |
