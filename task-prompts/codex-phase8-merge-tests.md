# CODEX-03 — Phase 8: Merge/Context/Conflict Tests

## Objective

Extend the integration test suite to cover the Phase 6 merge/context sync behaviors.
All new tests must run without Docker using mock injection.

## Owned Files

**Modify:**
- `tests/integration/delegation.integration.test.js`
- `tests/integration/delegation-mocks.js`

**Do not touch:**
- `src/` (any source file)
- `tests/integration/helpers.js`
- `tests/integration/taskmanager.integration.test.js`

---

## API Contract (Phase 6 additions in src/orchestrator/core.js)

After Phase 6, `delegate()` now:
- Auto-commits the parent worktree before `_runTask()` when `parentTaskId` is provided
- Pre-creates the child worktree and resets it to the parent's branch HEAD
- Returns `resultData` with these additional fields:
  - `conflicts: boolean` — true if merge had conflicts
  - `conflicting_files: string[]` — list of conflicting file paths (only when `conflicts=true`)
  - `merged: boolean` — true only when merge succeeded cleanly

When conflicts occur:
- `delegate()` returns successfully (does not throw)
- `resultData.conflicts === true`, `resultData.merged === false`
- Child worktree is NOT pruned — `task_diff(childId)` can still be called

When merge is clean:
- `resultData.conflicts === false`, `resultData.merged === true`
- Child worktree is pruned

Research tasks (`type = 'research' | 'analysis' | 'docs'`):
- No merge-back — `resultData.merged` is undefined, `resultData.conflicts` is undefined

---

## Mock Strategy Updates (tests/integration/delegation-mocks.js)

Add a `makeMockWorktreeManagerWithConflict()` function:

```js
export function makeMockWorktreeManagerWithConflict() {
  return {
    create: async (taskId, agentName) => ({
      path: `/tmp/mock/${taskId}`,
      branch: `agent/${agentName}/${taskId}`,
    }),
    merge: async (taskId, agentName) => ({
      success: false,
      conflicts: true,
      message: 'CONFLICT (content): Merge conflict in src/auth/session.js\nAutomatic merge failed',
    }),
    prune: async () => { throw new Error('prune should not be called on conflict'); },
    diff: async () => 'mock diff',
    changedFiles: async () => ['src/auth/session.js'],
    branchName: (taskId, agentName) => `agent/${agentName}/${taskId}`,
    worktreePath: (taskId, agentName) => `/tmp/mock/${taskId}`,
    reset: async () => {},
  };
}
```

Also update the existing `makeMockWorktreeManager()` to add `worktreePath` method (it's needed by the auto-commit block):

```js
// add to existing makeMockWorktreeManager():
worktreePath: (taskId, agentName) => join(tmpDir, `${agentName}-${taskId}`),
```

---

## New Tests to Add

Add a new `describe` block in `tests/integration/delegation.integration.test.js`:

```
describe('Phase 6 — Merge and Context Sync')
```

### Test 1 — clean merge sets merged=true, conflicts=false

```js
test('delegate() clean merge: resultData.merged=true, conflicts=false')
// Use makeMockWorktreeManager (existing) — merge returns success:true
// delegate() type='code'
// assert result.merged === true
// assert result.conflicts === false
```

### Test 2 — conflict: merged=false, conflicts=true, conflicting_files populated

```js
test('delegate() conflict: resultData.merged=false, conflicts=true, conflicting_files populated')
// Use makeMockWorktreeManagerWithConflict()
// inject into orch.worktreeManager
// delegate() type='code'
// assert result.merged === false
// assert result.conflicts === true
// assert Array.isArray(result.conflicting_files)
// assert result.conflicting_files.includes('src/auth/session.js')
```

### Test 3 — conflict: prune is NOT called (child worktree preserved)

```js
test('delegate() conflict: worktree prune is not called')
// Use makeMockWorktreeManagerWithConflict() but track prune call
// Add a prune call tracker: let pruned = false; override prune to set pruned=true
// assert pruned === false after delegate() returns
```

Wait — `makeMockWorktreeManagerWithConflict` has `prune` throw. That test is already covered by Test 2 (if prune were called, Test 2 would throw from the mock). Keep Test 3 explicit with a boolean tracker for clarity.

### Test 4 — research task skips merge entirely

```js
test('delegate() research type: no merge, no conflicts fields')
// type='research'
// Use makeMockWorktreeManager
// assert result.merged === undefined
// assert result.conflicts === undefined
```

### Test 5 — child task result_data persisted to SQLite (merged field durable)

```js
test('delegate() persists merged field to SQLite after clean merge')
// delegate() type='code', clean merge mock
// reload child task from DB: orch.taskManager.getTask(childId)
// assert task.result_data.merged === true
// This verifies the raw SQL persist after merge-back is working
```

### Test 6 — conflict result_data persisted to SQLite

```js
test('delegate() persists conflicts=true to SQLite after conflict')
// delegate() type='code', conflict merge mock
// reload child task from DB
// assert task.result_data.conflicts === true
// assert task.result_data.merged === false
```

---

## Getting the child task ID

After `delegate()` returns, to verify SQLite state you need the child task ID. Use:

```js
const tasks = await orch.taskManager.getTasks();
const child = tasks.find(t => t.is_delegated && t.subagent_name === 'gemini');
const childId = child.id;
```

Or use `getDelegatedTasks(parentTaskId)` if you have a parent task ID.

---

## Constraints

1. No real Docker — all tests inject `makeMockDockerRunner('success')` or `makeMockDockerRunner('failure')`
2. No real git operations — worktree mock handles all merge/prune/create calls
3. Each test gets its own fresh `Orchestrator` + `TaskManager` via `makeTmpDir()` with cleanup in `finally`
4. The auto-commit / child-reset-to-parent-HEAD behavior does NOT need to be tested here — that requires a real git repo and is an integration concern beyond unit test scope. Focus on: merge outcome in resultData, prune behavior, SQLite persistence.

---

## Running Tests

```bash
node --test tests/integration/delegation.integration.test.js
npm test
```

Both must pass with 0 failures.

---

## Definition of Done

- [ ] `makeMockWorktreeManagerWithConflict()` added to `delegation-mocks.js`
- [ ] `worktreePath` method added to existing `makeMockWorktreeManager()`
- [ ] 6 new tests in the Phase 6 describe block, all passing
- [ ] Total test count in the integration file ≥ 27 (21 existing + 6 new)
- [ ] `node --test tests/integration/delegation.integration.test.js` → 0 failures
- [ ] `npm test` → 0 failures
