# CLAUDE-02 — TaskManager: Delegation Methods + Orphan Hardening

## Objective

Extend the TaskManager with delegation-specific query methods and harden orphan recovery.
The schema and migration system already exist (CLAUDE-01). This task adds the methods
that the orchestrator delegate() flow will call.

## Owned Files

**Modify only:**
- `src/taskmanager/index.js`

**Create:**
- `src/taskmanager/delegation.test.js`

**Do not touch:**
- `src/orchestrator/core.js`
- `src/mcp-server/`
- `src/router/`
- Any other file

---

## Required API

### 1. `createDelegatedTask(parentTaskId, opts)`

```js
/**
 * Create a child task linked to a parent.
 * Sets is_delegated=true, parent_task_id=parentTaskId,
 * delegate_depth=parent.delegate_depth + 1.
 * Throws if parent not found or delegate_depth would exceed MAX_DELEGATE_DEPTH.
 *
 * @param {string} parentTaskId
 * @param {Object} opts — same shape as addTask() opts; is_delegated/parent_task_id/delegate_depth
 *                        are set automatically and must NOT be passed in opts
 * @returns {Promise<Object>} the created task
 */
async createDelegatedTask(parentTaskId, opts)
```

`MAX_DELEGATE_DEPTH = 3` — define as a module-level constant, exported.

If `parent.delegate_depth + 1 > MAX_DELEGATE_DEPTH`, throw:
```
Error: delegate_depth limit exceeded (max 3): task ${parentTaskId} is already at depth ${parent.delegate_depth}
```

### 2. `getDelegatedTasks(parentTaskId)`

```js
/**
 * Return all direct child tasks of the given parent.
 * @param {string} parentTaskId
 * @returns {Promise<Object[]>}
 */
async getDelegatedTasks(parentTaskId)
```

Single SQL query: `SELECT ... FROM tasks WHERE parent_task_id = ?`
Pass result through `_deserialise()`.

### 3. `getTaskTree(rootTaskId)`

```js
/**
 * Return the root task + all descendants (recursive via parent_task_id chain).
 * Result is a flat array ordered by delegate_depth ASC, then created_at ASC.
 * @param {string} rootTaskId
 * @returns {Promise<Object[]>}
 */
async getTaskTree(rootTaskId)
```

Use a recursive CTE:
```sql
WITH RECURSIVE tree AS (
  SELECT * FROM tasks WHERE id = ?
  UNION ALL
  SELECT t.* FROM tasks t JOIN tree ON t.parent_task_id = tree.id
)
SELECT * FROM tree ORDER BY delegate_depth ASC, created_at ASC
```

### 4. Orphan recovery hardening

Current orphan recovery in `initialize()`:
```js
// marks is_delegated=1 AND status='in_progress' tasks as failed
```

This is correct. Verify the following invariants hold and add inline comments if they do not:

1. Non-delegated `in_progress` tasks are NOT touched by orphan recovery (leave them; `resetStaleClaims` handles `claimed` tasks separately)
2. `routing_reason` is set to `'orchestrator_restart'` on orphaned tasks
3. Orphan recovery runs AFTER migrations complete, not before

If any invariant is not already enforced, fix it. Do not change the logic beyond these three points.

---

## Implementation Notes

- `createDelegatedTask` must call `addTask()` internally (do not duplicate INSERT logic)
- `getDelegatedTasks` and `getTaskTree` are read-only; they never mutate state
- All new methods follow the existing async pattern (return Promises even if better-sqlite3 is synchronous underneath)
- Use `_deserialise()` for all results so callers get JS types (boolean, parsed JSON, etc.)
- Export `MAX_DELEGATE_DEPTH` as a named export alongside the class

---

## Tests — `src/taskmanager/delegation.test.js`

Use `node:test` + `node:assert/strict`. Follow the pattern in `src/taskmanager/migrations.test.js`:
each test gets a `mkdtempSync` dir and a `finally { rmSync }` block.

**Required test cases:**

1. `createDelegatedTask` sets `is_delegated=true`, `parent_task_id`, `delegate_depth=1`
2. `createDelegatedTask` depth 1→2→3 works; depth 4 throws with correct message
3. `createDelegatedTask` throws if `parentTaskId` not found
4. `getDelegatedTasks` returns only direct children (not grandchildren)
5. `getTaskTree` returns root + all descendants in depth-first order
6. `getTaskTree` returns only the root task when there are no children
7. Orphan recovery: `is_delegated=1 AND status='in_progress'` → `failed` on startup
8. Orphan recovery: `is_delegated=0 AND status='in_progress'` → NOT touched on startup
9. Full delegation tree lifecycle: create parent, create child, complete child, complete parent

**Run with:** `node --test src/taskmanager/delegation.test.js`
All 9 tests must pass with 0 failures.

---

## Definition of Done

- [ ] `createDelegatedTask`, `getDelegatedTasks`, `getTaskTree` implemented in `src/taskmanager/index.js`
- [ ] `MAX_DELEGATE_DEPTH = 3` exported as named constant
- [ ] Orphan recovery invariants verified/fixed with inline comments
- [ ] `src/taskmanager/delegation.test.js` with 9 tests, all passing
- [ ] `node --test src/taskmanager/delegation.test.js` → 9 pass, 0 fail
- [ ] Full test suite still green: `npm test` → 0 failures
