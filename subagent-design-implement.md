# Vendor-Agnostic Subagent Platform — Implementation Blueprint

> **Status:** Signed off. Ready for implementation.
> **Strategy:** Four vertical slices — Contract → Logic → Capability → Polish.

---

## Context

The current system is a working multi-worker orchestrator. Three gaps block it from being a true subagent platform:

1. **Contract gap** — Provider logic (CLI args, auth, output parsing) is hardcoded across `core.js` and `runner.js` instead of isolated in adapters.
2. **Identity gap** — Agent name equals provider name. You cannot define two logical roles backed by the same provider.
3. **Execution model gap** — The system is waterfall (plan upfront, batch execute). The goal is delegation: the Tech Lead can spawn a specialized subagent mid-session, get the result back, and continue.

Worker-initiated delegation (container → host IPC) is **deferred to Phase 9**. The first production cut delivers host-led delegation via a synchronous `delegate()` MCP tool.

---

## Slice 1 — The Contract (Phases 1–3)

### Phase 1 — Provider Adapter Layer

Extract all vendor-specific logic from `core.js:41-77` and `runner.js:26-145` into `src/providers/`.

**New files:**
```
src/providers/base.js      — interface definition
src/providers/gemini.js    — CLI args, isolated auth mount, output parser
src/providers/claude.js    — CLI args, read-only auth mount, output parser
src/providers/codex.js     — CLI args, auth mount, output parser
src/providers/registry.js  — Map<providerName, adapter>; getAdapter(name); listProviders()
src/providers/providers.test.js
```

**Each adapter implements:**
- `buildCliArgs(prompt, opts)` → `string[]`
- `buildAuthMounts(taskId, cfg)` → `Promise<{ args: string[], cleanup: () => Promise<void> }>`
- `parseOutput(stdout, stderr, durationMs)` → `{ status, summary, token_usage? }`
- `defaultModel()` → `string`

**Changes to existing files:**
- `runner.js`: remove `AUTH_DIRS`, `AUTH_MOUNTS`, `WORKER_SETTINGS_HOST`, `_isolatedGeminiAuth()`, all `agentName === 'gemini'` branches. Accept `adapter` parameter in `run()`. Call `adapter.buildAuthMounts()`.
- `core.js`: remove `DEFAULT_AGENTS` (lines 41–77) and standalone `parseGeminiOutput`, `parseClaudeOutput`, `parseCodexOutput` functions. Update `initialize()` and `_runTask()` to resolve adapter via `getAdapter(provider)`.

**Acceptance criteria:**
- `grep "=== 'gemini'" runner.js` → 0 matches
- `grep "DEFAULT_AGENTS\|parseGeminiOutput\|parseClaudeOutput\|parseCodexOutput" core.js` → 0 matches
- `getAdapter('unknown')` throws with provider name in message
- `getAdapter('claude-code')` returns ClaudeAdapter (backward-compat alias)
- `npm test` — 0 failures

---

### Phase 2 — Config Schema Reform

`agents.json` becomes a subagent registry. Logical role name is the key; provider is a field.

**New schema:**
```json
{
  "platform": {
    "max_delegate_depth": 2,
    "fallback_policy": "next_preferred",
    "default_timeout_ms": 300000,
    "max_containers": 10
  },
  "researcher": {
    "provider": "gemini",
    "model": "default",
    "description": "Research and summarize codebase behavior. Use for unknown modules, call flow tracing, docs.",
    "capabilities": ["research", "analysis", "docs"],
    "preferred_providers": ["gemini", "codex"],
    "quota": 70,
    "concurrency": 3,
    "timeoutMs": 300000,
    "max_retries": 1
  },
  "implementer": {
    "provider": "claude",
    "model": "claude-sonnet-4-6",
    "description": "Write and refactor code. Use for code, test, debug, review tasks.",
    "capabilities": ["code", "refactor", "test", "debug", "review"],
    "preferred_providers": ["claude", "codex"],
    "quota": 20,
    "concurrency": 1,
    "timeoutMs": 300000,
    "max_retries": 2
  },
  "planner": "researcher"
}
```

**Migration rule in `_loadAgentsJson()`:**
If `provider` field is absent, infer from key name (`"gemini"` → `provider: "gemini"`, `"claude-code"` → `provider: "claude"`). Emit a deprecation warning. This is a compatibility shim — not the target model.

**New files:**
- `src/types/agent-schema.js` — JSON Schema + `validateAgentsJson(config)`: hard error on unknown provider or invalid capabilities; warning on quota sum > 100.
- `src/types/agent-schema.test.js`

**Acceptance criteria:**
- Old `agents.json` (no `provider` field) loads without error; emits deprecation warning
- Unknown provider → `validateAgentsJson()` throws
- `planner` key resolves to correct agent entry
- `platform` section parsed and accessible as `this.platform` on Orchestrator

---

### Phase 3 — Idempotent SQLite Migrations

Replace raw DDL in `schema.sql` with versioned migrations in `TaskManager.initialize()`.

**Migration pattern — versioned and additive:**

Each future schema change increments `CURRENT_VERSION` and adds a new entry to `MIGRATIONS`. Migrations are applied in order and are never modified after release.

```js
const MIGRATIONS = {
  1: `
    ALTER TABLE tasks ADD COLUMN subagent_name   TEXT;
    ALTER TABLE tasks ADD COLUMN provider        TEXT;
    ALTER TABLE tasks ADD COLUMN model           TEXT;
    ALTER TABLE tasks ADD COLUMN parent_task_id  TEXT REFERENCES tasks(id);
    ALTER TABLE tasks ADD COLUMN delegate_depth  INTEGER DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN is_delegated    INTEGER DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN routing_reason  TEXT;
    ALTER TABLE tasks ADD COLUMN result_data     TEXT;
  `,
  // 2: `ALTER TABLE tasks ADD COLUMN next_field TEXT;`,
};
const CURRENT_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

const dbVersion = this.db.pragma('user_version', { simple: true });
for (let v = dbVersion + 1; v <= CURRENT_VERSION; v++) {
  if (MIGRATIONS[v]) {
    this.db.exec(MIGRATIONS[v]);
    this.db.pragma(`user_version = ${v}`);
  }
}
```

Future contributors add a numbered key to `MIGRATIONS` and bump nothing else. Applied migrations are never edited.
```

`result_data` — new field, structured JSON result envelope:
```json
{
  "summary": "...", "provider": "gemini", "model": "gemini-2.5-pro",
  "subagent_name": "researcher", "files_changed": ["src/auth/session.js"],
  "commit_hash": "abc123", "conflicts": false,
  "token_usage": { "input": 1200, "output": 300 }, "duration_ms": 12345
}
```

`result_ref` — unchanged, remains the log file path. Do not overload it.

Update `_deserialise()` and `updateStatus()` in `taskmanager/index.js` to handle new fields. Update `Task` type in `src/types/index.js`.

**Acceptance criteria:**
- Fresh install: all 8 new columns present after startup
- Existing install (version 0): columns added on next startup, no error
- Second startup on version-1 DB: no error, no duplicate columns
- `npm test` — 0 failures

---

## Slice 2 — The Logic (Phase 4)

### Phase 4 — Two-Stage Routing

Upgrade `AgentRouter` from single-stage (agent name = provider) to two-stage (role → provider).

**Stage 1 — Role selection:** match `task.type` to subagent entry by `capabilities`. Returns logical subagent name.

**Stage 2 — Provider selection:** walk `preferred_providers` in order. Skip providers in `task.previous_agents` (already failed) or at `concurrency` limit. First available wins. Write to `routing_reason`.

**Changes:**
- `src/router/index.js`: rewrite `selectAgent()` for two-stage logic. Extend `validate()` to check provider names against registry and capabilities against `VALID_TYPES`.
- `src/orchestrator/core.js`: `assignTasks()` writes `subagent_name` and `routing_reason` to task record.

**Acceptance criteria:**
- Task routed to preferred provider when available
- Falls back to `preferred_providers[1]` when `preferred_providers[0]` is in `previous_agents`
- Falls back to `preferred_providers[1]` when `preferred_providers[0]` is at concurrency limit
- `routing_reason` populated on every assigned task
- All existing router tests pass

---

## Slice 3 — The Capability (Phases 5–6)

### Phase 5 — Host-Led Delegation

New MCP tool: `delegate(subagent_name, prompt, type?)`.

This is the execution model shift: the Tech Lead can spawn a specialized subagent mid-session, block until it completes, and receive the result in the same turn.

**Constraint:** `delegate()` is host-led only in this production cut. The Tech Lead (via MCP) is the sole initiator. Worker containers do not call `delegate()` and have no path to initiate delegation. Worker-led IPC is Phase 9.

**`delegate()` handler logic:**
1. Resolve `subagent_name` from config — error if unknown
2. Check `delegate_depth` of current context against `platform.max_delegate_depth` — return error message if exceeded (do not throw; the Tech Lead should receive a clear explanation)
3. Create child task record with `parent_task_id`, `is_delegated: 1`, `delegate_depth: parent.depth + 1`, `subagent_name`, `provider`, `model`, `routing_reason` — these are first-class fields on the task record, not shoehorned into `description` or any other existing field
4. Route child task via two-stage router (Phase 4)
5. Call `_runTask(childTask)` — same execution path as all tasks; no separate runner, no parallel code path
6. **Await synchronously** — MCP handler does not return until `_runTask` resolves
7. Return `result_data` envelope to Tech Lead

**Tool timeout:** Set MCP tool response timeout = `agent.timeoutMs + 10000` (10s buffer). Without this, the MCP framework can timeout before the child agent finishes.

**Changes:**
- `src/mcp-server/tools.js`: add `delegate` tool definition
- `src/mcp-server/index.js`: wire handler, set tool timeout

**Acceptance criteria:**
- `delegate("researcher", "Summarize auth/session.js")` creates child task with `parent_task_id` and `is_delegated=1`
- MCP handler does not return until child task reaches `done` or `failed`
- Depth limit exceeded → clear error message returned (not a crash)
- Unknown subagent name → clear error message returned
- Tool timeout > agent timeoutMs

---

### Phase 6 — Merge and Context Sync

Completes the delegation loop: child sees parent's latest work; parent gets child's output on its disk.

**Before child execution (inside `delegate()` handler, before `_runTask`):**
1. Auto-commit parent worktree — unconditional (not "if needed"). Uncommitted parent work is invisible to git; the child would miss it.
2. Create child worktree branching from parent's current HEAD (not base branch).

**After child completes:**
- If `files_changed.length > 0`: merge child branch into parent branch
  - Commit message: `Merge subagent <subagent_name> result for task <child_task_id>` — required for git reflog debugging
  - Clean merge → `conflicts: false` in `result_data`; prune child worktree normally
  - Merge conflict → `conflicts: true`, `conflicting_files: [...]` in `result_data`; **do not prune the child worktree or delete the child branch** — leave both available so the Tech Lead can call `task_diff(child_id)` to inspect the changes and resolve manually; delegation still returns successfully
- If `files_changed.length === 0` (research/analysis tasks): skip merge; prune child worktree

**Changes:**
- `src/orchestrator/core.js`: add pre-delegation auto-commit and child worktree creation inside `delegate()` handler; add post-completion merge-back logic; skip `prune()` when conflicts detected
- `src/worktree/index.js`: no structural changes needed; reuse `create()`, `merge()`, `diff()`

**Acceptance criteria:**
- Child can read a file modified by parent (but not yet committed) during its execution
- After clean delegation, parent worktree contains child's new/modified files; child branch pruned
- Merge commit message format: `Merge subagent <name> result for task <id>`
- Merge conflict → `result_data.conflicts = true`; child worktree and branch still exist; `task_diff(child_id)` returns the child's diff
- Research task (no files changed) → no merge commit; child worktree pruned

---

## Slice 4 — The Polish (Phases 7–8)

### Phase 7 — Observability, Safety, and Orphan Recovery

**New MCP tools:**
- `list_subagents()` — returns subagent roster: name, provider, capabilities, current running count. Required for Tech Lead to discover valid names before calling `delegate()`.

**Extended MCP tools:**
- `task_status(id?, subagent_name?)` — add `subagent_name` filter
- `task_diff(id)` — prepend `provider`, `model`, `subagent_name` to diff header
- `workforce_status()` — show subagent names and delegation depth per task

**Routing logs:** log routing decision at each stage — which role was matched, which provider was selected, and why (quota, concurrency, fallback).

**Orphan recovery on startup:**
Extend `TaskManager.initialize()`: after applying migrations, query specifically for `is_delegated=1, status='in_progress'` tasks. These are orchestrator-owned delegated tasks whose parent MCP call died when the process restarted. Mark them `failed` with `routing_reason = "orchestrator_restart"`.

Scope is intentionally narrow: only `is_delegated=1` tasks are recovered here. Non-delegated `in_progress` tasks are handled separately by the existing `resetStaleClaims()` (stale-claim timeout logic). Keeping the two recovery paths separate makes restart handling deterministic — each path has a single, clear trigger condition.

**Changes:**
- `src/mcp-server/tools.js`: add `list_subagents`; extend 3 existing tools
- `src/mcp-server/index.js`: wire handlers
- `src/taskmanager/index.js`: add orphan recovery in `initialize()`

---

### Phase 8 — Tests

Node.js `node:test` throughout. Written alongside each phase, collected here for reference.

**Migration tests:**
- Fresh DB: all 8 new columns present after Phase 3 init
- Existing DB (version 0): migrated on startup, no error
- Version-1 DB on second startup: no error

**Adapter tests (per provider):**
- `buildCliArgs` returns correct shape
- `parseOutput` with real fixture stdout → correct `{ status, summary, token_usage }`
- `buildAuthMounts` with non-existent dir → `{ args: [], cleanup: fn }`
- `getAdapter('unknown')` throws

**Routing tests:**
- Two-stage: role matched by capability, provider by `preferred_providers`
- Fallback: skip previous_agents; skip concurrency-exceeded provider
- Depth guard: `delegate_depth >= max_delegate_depth` → error returned

**Delegation tests:**
- Child task created with `parent_task_id`, `is_delegated=1`, correct `delegate_depth`
- MCP handler blocks until child completes
- `result_data` shape matches schema

**Merge/context tests:**
- Parent uncommitted change visible to child after auto-commit
- Child modified file present in parent worktree after delegation
- Merge commit message format correct
- Conflict → `result_data.conflicts = true`, delegation succeeds

**Orphan recovery test:**
- Seed DB with `is_delegated=1, status='in_progress'` task
- Initialize TaskManager
- Verify task status is `failed` with reason `orchestrator_restart`

**Backward compat test:**
- Old `agents.json` (no `provider` field) loads and routes correctly

---

## Phase 9 — Worker-Led IPC (Deferred)

HTTP Spawn API (`src/spawn-api/index.js`). Enables worker containers to call `POST /spawn` mid-execution, blocking until the child result is returned. This gives workers autonomous delegation capability without returning control to the Tech Lead.

**Not in the first production cut.** Implement only after Phases 1–8 are stable and the foundation has been in production.

---

## Build Order

```
Slice 1: Phase 1 → Phase 2 → Phase 3    (Phases 1-2 can run in parallel; Phase 3 is independent)
Slice 2: Phase 4                          (requires Phase 1+2 complete)
Slice 3: Phase 5 → Phase 6               (Phase 6 extends Phase 5; both require Phase 4)
Slice 4: Phase 7 → Phase 8               (Phase 7 requires Phase 5+6; Phase 8 is continuous)
Deferred: Phase 9                         (after Slice 4 is production-stable)
```

---

## Files to Preserve (Extend Only)

| File | Constraint |
|---|---|
| `src/taskmanager/index.js` | Additive changes only — state machine and ACID transactions are correct |
| `src/worktree/index.js` | No changes — `create()`, `merge()`, `diff()` are reused as-is |
| `src/docker/runner.js` | Remove hardcoded provider branches only — spawn/kill/log core is correct |
| `src/router/index.js` | Extend `selectAgent()` and `validate()` only — `_quotaRatio` and `_pickByQuota` are reused |

---

## Definition of Done

1. A subagent is defined once in `agents.json` with a logical name and `provider` field
2. Changing `provider` in `agents.json` requires zero code changes
3. Tech Lead can call `delegate("researcher", "Summarize this module")` and receive a result in the same MCP turn
4. Child worktree inherits parent commits; child file changes merge back to parent
5. Old `agents.json` format still works (with deprecation warning)
6. `npm test` passes with 0 failures after every phase

---

## Verification Checkpoints

```bash
# Phase 1: no provider-specific branches remain
grep -n "=== 'gemini'\|AUTH_DIRS\|DEFAULT_AGENTS" src/docker/runner.js src/orchestrator/core.js
# Expected: 0 matches

# Phase 3: new columns present
sqlite3 ~/.local/share/multi-agent-orchestrator-v3/tasks.db ".schema tasks" \
  | grep -E "subagent_name|parent_task_id|is_delegated|result_data"

# Phase 3: second startup does not throw
node -e "
  import('./src/taskmanager/index.js').then(async ({ TaskManager }) => {
    const tm = new TaskManager('/tmp/test-migrate');
    await tm.initialize();
    await tm.initialize(); // second call must not throw
    tm.close();
    console.log('OK');
  });
"

# All phases:
npm test
# Expected: 0 failures
```
