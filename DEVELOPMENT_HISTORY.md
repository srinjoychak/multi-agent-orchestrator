# Development History — Multi-Agent Orchestrator v1

A log of decisions, architecture choices, and the Claude + Gemini collaboration
that produced this codebase.

---

## Session Overview

**Project:** Multi-Agent Orchestrator POC v1
**Goal:** Build a vendor-neutral orchestrator coordinating Claude Code + Gemini CLI as a team
**Tech Lead:** Claude Sonnet 4.6
**Dev Agent:** Gemini CLI
**Duration:** Single chat session, 4 PRs
**Repo:** https://github.com/srinjoychak/multi-agent-orchestrator

---

## PR #1 — Initial Scaffold

**Branch:** `master` (direct)
**Author:** Claude Sonnet 4.6
**Tests:** 80 passing

### What was built
- `src/types/index.js` — Task schema, state machine (`VALID_TRANSITIONS`), `createTask()`, `isValidTransition()`
- `src/taskmanager/index.js` — Full task lifecycle with proper-wait file locking, dependency checking, auto-retry, stale claim reset
- `src/comms/file-channel.js` — File-based inbox messaging (consume-once, peek, broadcast, subscribe/poll)
- `src/adapters/base.js` — `AgentAdapter` base class with `execute()`, `isAvailable()`, timeout handling
- `src/adapters/claude-code.js` — Claude Code adapter stub
- `src/adapters/gemini.js` — Gemini adapter stub
- `src/orchestrator/index.js` — Full orchestration pipeline (decompose → assign → execute → monitor → merge → report)
- `src/merger/index.js` — Git branch merge, conflict detection, worktree cleanup, report generation

### Key decisions
- **ES modules only** — no TypeScript, no build step, no dependencies (pure Node.js built-ins)
- **File locking via polling** — no native lock files; TaskManager polls with backoff to serialize mutations to `tasks.json`
- **Git worktrees for isolation** — each agent gets a physically isolated directory on a separate branch; no shared file state
- **File-based IPC for v1** — simple, debuggable, no infrastructure required. Interface abstracted so MQTT can replace it in v2

---

## PR #2 — CLI Schema Validation + Full Test Suite

**Branch:** `feat/adapters-tests-orchestrator`
**Authors:** Claude Sonnet 4.6 (CLI validation, adapter fixes) + Gemini CLI (tests G1–G5)
**Tests:** 129 passing (80 → 129)

### What was built
**Claude's work:**
- Validated real `claude --output-format json` output schema by live invocation:
  `{ type, is_error, result, duration_ms, session_id, ... }`
- Validated real `gemini --output-format json` output schema:
  `{ session_id, response, stats }`
- Fixed `ClaudeCodeAdapter.parseOutput()` — uses `is_error` for status, `result` for text
- Fixed `GeminiAdapter.parseOutput()` — uses `response` for text, handles newline-delimited stream
- Added `--no-session-persistence` to Claude buildArgs (avoids session disk overhead)
- Added `--yolo` to Gemini buildArgs (auto-approve tool actions for non-interactive use)
- Added `execute()` override in both adapters — post-execution `git diff --name-only HEAD` for `filesChanged`

**Gemini's work (tasks G1–G5):**
- G1: `src/adapters/adapters.test.js` — 35 tests covering all adapter methods
- G2: `src/merger/merger.test.js` — ResultMerger unit tests
- G3: Dependency-aware `executeTasks()` with wave-based scheduling
- G4: `loadTasksFromFile()` + `--tasks` CLI flag
- G5: `tests/integration/` scaffolding with CLI-availability skip guards

**Issues caught in review:**
- Gemini dropped `--no-session-persistence` and `--yolo` from buildArgs — restored by Claude
- Test assertions hardcoded old buildArgs arrays — updated to include restored flags
- `package.json` test glob `src/**/*.test.js` missed `tests/integration/` — extended

---

## PR #3 — Phase 1: Make It Runnable

**Branch:** `feat/phase1-runnable`
**Authors:** Gemini CLI (P1–P5) + Claude Sonnet 4.6 (review)
**Tests:** 135 passing (129 → 135)

### What was fixed
- **P1:** `resultsDir` never created — added to `initialize()` dir loop
- **P2:** `resetStaleClaims()` never called — wired into `monitorUntilComplete()` loop
- **P3:** `Gemini-tasks.md` deleted from repo, `*-tasks.md` added to `.gitignore`
- **P4:** `executeTasks()` could double-execute — added `dispatched` Set, tasks tracked by ID
- **P5:** `loadTasksFromFile()` called `process.exit()` inside a method — refactored to throw; CLI's `main()` handles exit

### Issues caught in review
- **P4:** Gemini dropped `t.status === 'in_progress'` from `newlyInProgress` filter — would have dispatched tasks that failed to claim. Caught, corrected.
- **.gitignore:** Duplicate entries for `.agent-team/` and `.worktrees/` — cleaned up.

---

## PR #4 — Phase 2: Quality

**Branch:** `feat/phase2-quality`
**Authors:** Gemini CLI (Q1–Q3) + Claude Sonnet 4.6 (review)
**Tests:** 141 passing (135 → 141)

### What was built
- **Q1:** Capability-aware routing — `capabilities` array on adapters, `type` field on tasks, `assignTasks()` matches before round-robin. 5 new tests.
- **Q2:** Enriched decomposition prompt — RULES block, strict OUTPUT SCHEMA, few-shot EXAMPLE, `type` field required
- **Q3:** DX polish — startup banner, `--version`/`-v` flag, `npm run orchestrate`, `test:unit`, `test:integration`

### Issues caught in review
- **Q3:** `--version` check ran after `new Orchestrator()` instantiation — moved before. Minor but flagged for correctness.

---

## Key Architecture Decisions

### Why git worktrees?
Each agent needs a physically separate directory to avoid file conflicts. Branches alone aren't enough — two agents could write to the same file path on different branches, causing merge conflicts at every merge. Worktrees give each agent its own filesystem view while sharing the git history.

### Why file-based IPC?
For v1, simplicity wins. File-based messaging is debuggable with `ls` and `cat`, requires no infrastructure, and works offline. The `CommChannel` interface is abstracted so `FileCommChannel` can be replaced with `MqttCommChannel` in v2 without touching orchestrator or adapter code.

### Why no TypeScript?
Keep the barrier to contribution low for a POC. JSDoc provides type hints in editors without a build step. If the project grows beyond POC, TypeScript migration is straightforward.

### Why zero npm dependencies?
`node:test`, `node:assert`, `node:fs`, `node:path`, `node:child_process` cover everything needed. No lockfile churn, no CVEs, no install step in CI.

### Why validate CLI output schemas by live invocation?
The adapters originally guessed at JSON shapes. Live invocation (`claude -p "say: hello" --output-format json`) revealed the real schemas and prevented a class of silent parse failures where `summary` would always be an empty stringified object.

---

## What Phase 3 Changes

The v1 model is a black-box CLI tool. You run it and wait. The fundamental limitation: **zero human visibility or control during execution**.

Phase 3 (on `master`) shifts the model:
- The chat session (Claude Code, Gemini CLI, or any AI gateway) becomes the Tech Lead
- The orchestrator exposes discrete verbs: `decompose`, `assign`, `execute`, `accept`, `reject`, `merge`, `status`
- Every step is visible in the chat window; the Tech Lead reads results and decides next action
- A review/feedback loop: Tech Lead accepts or rejects each task result with specific feedback
- Role config in `agents.json` replaces hardcoded capabilities

All v1 infrastructure is reused. Only the interface model changes.
