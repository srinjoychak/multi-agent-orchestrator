# Next Steps — Multi-Agent Orchestrator

_Last updated: 2026-03-20 by Claude Sonnet 4.6 (Tech Lead)_

---

## Where We Are Now

V1 is complete and archived on `archive/v1-autonomous-cli`. The `master` branch is the active
development branch. Key fixes applied (Windows .cmd resolution, Claude permission flags,
false-positive detection) are all committed and 141 tests pass.

---

## Immediate Task: Platform Assessment (Before Phase 3)

### What is Windows-Specific Today?

| Code | File | Windows-only? |
|------|------|--------------|
| `IS_WINDOWS` + `cmd.exe /c` routing | `src/adapters/base.js:9,86-88` | Yes |
| `_getChangedFiles()` uses raw `execFileAsync('git', ...)` | `claude-code.js:164`, `gemini.js:159` | No — `git.exe` resolves fine |
| `path.join` / `path.resolve` | `orchestrator/index.js` | No — cross-platform |
| `mkdir`, `readFile`, `writeFile` | various | No — cross-platform |
| `process.env` expansion | `base.js:107` | No — works on all platforms |

**Verdict:** The only Windows-specific code is the `IS_WINDOWS` guard in `base.js`. Everything
else is cross-platform Node.js already.

### Plan: `platform/` Folder (Not `windows-adaptor/`)

Instead of isolating "Windows code" into a separate folder (which would require conditional
imports and complicate the adapter hierarchy), the better pattern is:

1. Keep the `IS_WINDOWS` platform guard in `base.js` as-is — it's already a clean 3-line
   conditional that silently no-ops on Linux/Mac.
2. Create a `platform/` folder with platform-specific documentation and test helpers.
3. Create `platform/windows/README.md` — agent-friendly Windows setup guide.
4. Create `platform/linux/README.md` — agent-friendly Linux/Mac setup guide.
5. Add `platform/detect.js` — exports `IS_WINDOWS`, `IS_LINUX`, `IS_MAC` constants so all
   files import from one place rather than each calling `platform()` independently.

This avoids code duplication while making platform docs easy to find.

### Linux/Mac Compatibility: What Needs Work?

The codebase is ~95% cross-platform today. Known gaps:

| Issue | Effort | Notes |
|-------|--------|-------|
| `IS_WINDOWS` cmd.exe routing | Already handled — no-op on Linux | Done |
| npm global CLI resolution | Low — `claude` and `gemini` are in PATH on Linux | Works without `.cmd` |
| `.agent-team/` path separators | None — `node:path` handles this | Done |
| Git worktree creation | None — git is cross-platform | Done |
| `SIGTERM` in `abort()` | Low — SIGTERM works on Linux; on Windows it's ignored | Minor |
| Shell timeout in `isAvailable()` | None — uses `timeout` option in execFile | Done |

**Effort estimate: 1–2 hours** to make it fully Linux/Mac compatible (mostly the `platform/detect.js`
refactor and writing docs).

### Ubuntu WSL Strategy

WSL is ideal for Linux adapter development because:
- It shares the Windows filesystem (`/mnt/c/...`) so the same repo is accessible.
- `npm i -g @anthropic-ai/claude-code` and `npm i -g @google/gemini-cli` install Linux binaries.
- Running `npm test` from WSL validates Linux code paths without a separate machine.
- Git worktrees work identically in WSL.

**Workflow:** Develop on Windows, run `npm test` from WSL to validate Linux paths. The
`IS_WINDOWS` guard will be `false` in WSL, exercising the Linux branch.

---

## Phase 3: Chat-Driven Orchestration

**Branch:** `feat/phase3-chat-driven`

**Vision:** The Claude Code chat window IS the Tech Lead. Instead of a black-box
`node orchestrator.js "big prompt"` that runs autonomously, the user drives each step
from the chat session. Claude (chat) plans → assigns → reviews → approves/rejects.

### Step 1 — Refactor Orchestrator into a Library

Split `src/orchestrator/index.js` into:

```
src/orchestrator/
  core.js          ← Orchestrator class (no main(), no process.argv)
  cli.js           ← Thin verb router (the new index.js)
  steps/
    decompose.js   ← Returns task array, does NOT auto-execute
    assign.js      ← Returns assignment plan, does NOT auto-execute
    execute.js     ← Executes one task by ID
    merge.js       ← Merges one branch by task ID
    status.js      ← Returns current session state
```

Each step is independently invocable. The chat session calls them one at a time.

### Step 2 — Session State (`session.json`)

```json
// .agent-team/session.json
{
  "sessionId": "sess-abc123",
  "projectRoot": "/path/to/project",
  "prompt": "Build a REST API with auth",
  "tasks": [...],
  "assignments": { "T1": "claude-code", "T2": "gemini" },
  "status": "assigned",
  "createdAt": "2026-03-20T10:00:00Z",
  "updatedAt": "2026-03-20T10:05:00Z"
}
```

### Step 3 — CLI Verb Interface

```bash
# Step-by-step (chat-driven mode)
node orchestrator.js decompose "Build a REST API with auth and tests"
node orchestrator.js assign
node orchestrator.js execute T1
node orchestrator.js execute T2
node orchestrator.js status
node orchestrator.js accept T1
node orchestrator.js reject T2 "Missing error handling on /login"
node orchestrator.js merge T1
node orchestrator.js report

# Autonomous (v1 compat — single command runs all steps)
node orchestrator.js run "Build a REST API with auth and tests"
```

### Step 4 — Agent Configuration (`agents.json`)

```json
// agents.json (project-level, checked in)
{
  "claude-code": {
    "role": "developer",
    "capabilities": ["code", "refactor", "test", "debug"],
    "weight": 1
  },
  "gemini": {
    "role": "developer",
    "capabilities": ["research", "docs", "analysis", "code", "test"],
    "weight": 1
  }
}
```

Replaces hardcoded capability arrays in adapter constructors. The Tech Lead reads this file
to make routing decisions.

### Step 5 — Review/Feedback Loop

When Claude (chat) reviews a completed task result:
- `accept T1` → marks task done, eligible for merge
- `reject T2 "reason"` → re-queues task with rejection note appended to description
  so the agent gets feedback on the retry

### Task Breakdown for Phase 3

**Claude (Tech Lead) will implement:**
- `src/orchestrator/core.js` — refactored library class
- `src/orchestrator/cli.js` — verb router
- `src/orchestrator/steps/decompose.js`
- `src/orchestrator/steps/assign.js`
- `agents.json` schema and loading

**Gemini (Developer) will implement:**
- `src/orchestrator/steps/execute.js`
- `src/orchestrator/steps/merge.js`
- `src/orchestrator/steps/status.js`
- `.agent-team/session.json` read/write helpers
- Tests for all new step modules

---

## Sequence

```
[ NOW ]   1. Create platform/detect.js + platform/windows/README.md + platform/linux/README.md
          2. Update base.js to import IS_WINDOWS from platform/detect.js
          3. Add cross-platform test run instructions using WSL

[ NEXT ]  4. Branch: feat/phase3-chat-driven
          5. Implement Step 1 (refactor orchestrator into library)
          6. Implement Step 2 (session.json)
          7. Implement Step 3 (verb CLI)
          8. Delegate Steps 4+5 to Gemini

[ LATER ] 9. MQTT transport (v2) — only after Phase 3 is stable
         10. A2A protocol — only after MQTT
```

---

## Decisions to Revisit

| Decision | Current State | Revisit When |
|----------|--------------|--------------|
| File locking via `lockfile` | Works; single-machine only | Before MQTT/multi-machine |
| `--dangerously-skip-permissions` | Required for worktree execution | When Claude adds worktree permission mode |
| Round-robin task assignment | Simple but ignores agent load | When >2 agents or long tasks |
| `results.json` as merge output | Flat file | When streaming results needed |
