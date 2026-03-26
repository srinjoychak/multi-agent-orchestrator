# Gemini Task: Orchestrator Reliability Refactor (R1–R5)

**Role**: You are a senior engineer fixing critical reliability bugs in the Multi-Agent Orchestrator v3.
**Working directory**: `/mnt/d/ALL_AUTOMATION/copilot_adapter`
**Branch**: `master`
**Test command**: `npm test` (must pass 77+ tests, 0 failures at all times)

---

## Background — What Is Broken and Why

This orchestrator decomposes prompts into tasks, assigns them to Docker-isolated Gemini/Claude workers, and executes them in parallel git worktrees. There are 5 critical bugs causing **tasks to loop endlessly without progress**, **merge conflicts on every accept**, and **silent infinite loops** that waste time and tokens.

You will fix all 5 bugs, write tests for each fix, and validate everything passes.

---

## Bug R1: TASK_CONTEXT.md Causes Guaranteed Merge Conflicts

**Root cause**: `_autoCommit()` in `src/orchestrator/core.js:490-512` runs `git add -A` which stages `TASK_CONTEXT.md`. Every task branch has a different `TASK_CONTEXT.md`. Every `task_accept()` merge conflicts on this file.

**Fix**: Delete `TASK_CONTEXT.md` from the worktree BEFORE `_autoCommit()` runs.

**File to modify**: `src/orchestrator/core.js`

**Current code at lines 379-384**:
```javascript
      // Auto-commit any uncommitted changes the agent left behind.
      if (filesChanged.length > 0) {
        await this._autoCommit(worktreePath, task.id);
      }
```

**Change to**:
```javascript
      // Remove the task context file before committing — it's per-task
      // ephemeral state and will cause merge conflicts on every task_accept().
      const ctxPath = join(worktreePath, 'TASK_CONTEXT.md');
      await rm(ctxPath, { force: true }).catch(() => {});

      // Auto-commit any uncommitted changes the agent left behind.
      if (filesChanged.length > 0) {
        await this._autoCommit(worktreePath, task.id);
      }
```

Note: `rm` is already imported at line 18: `import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';`
Note: `join` is already imported at line 17: `import { join, resolve } from 'node:path';`

**Verification**: After this fix, `TASK_CONTEXT.md` should NOT appear in `task_diff()` output and `task_accept()` should never conflict on it.

---

## Bug R2: executeTasks() Is an Infinite Loop With No Exit Condition

**Root cause**: `executeTasks()` in `src/orchestrator/core.js:207-254` is `while(true)` with only `isAllComplete()` as exit. Tasks that cycle between `pending → in_progress → failed → pending` never reach a terminal state until `max_retries` is exhausted — which takes up to 6 cycles × 300s = 30 minutes of silent looping.

**Fix**: Add a circuit breaker — maximum iterations AND a total elapsed time limit.

**File to modify**: `src/orchestrator/core.js`

**Replace the `executeTasks()` method (lines 207-254) entirely with**:

```javascript
  /**
   * Execute all tasks in dependency-aware parallel waves.
   * Circuit breaker: exits after maxIterations or totalTimeoutMs to prevent
   * infinite loops when tasks keep cycling between pending/failed.
   * @param {Object} [options]
   * @param {number} [options.maxIterations=50]
   * @param {number} [options.totalTimeoutMs=600000] — 10 minutes default
   */
  async executeTasks(options = {}) {
    const maxIterations = options.maxIterations ?? 50;
    const totalTimeoutMs = options.totalTimeoutMs ?? 600_000;
    const dispatched = new Set();
    const startTime = Date.now();
    let iteration = 0;
    let lastStateHash = '';

    while (true) {
      iteration++;
      const elapsed = Date.now() - startTime;

      // Circuit breaker: max iterations
      if (iteration > maxIterations) {
        console.error(`[orchestrator] Circuit breaker: exceeded ${maxIterations} iterations. Stopping.`);
        break;
      }

      // Circuit breaker: total timeout
      if (elapsed > totalTimeoutMs) {
        console.error(`[orchestrator] Circuit breaker: exceeded ${Math.round(totalTimeoutMs / 1000)}s total timeout. Stopping.`);
        break;
      }

      const allTasks = await this.taskManager.getTasks();

      // Circuit breaker: stuck detection — if task states haven't changed in 3 consecutive iterations
      const stateHash = allTasks.map(t => `${t.id}:${t.status}:${t.retries}`).join('|');
      if (stateHash === lastStateHash) {
        // Check if everything that's not done/failed is just stuck
        const active = allTasks.filter(t => t.status !== 'done' && t.status !== 'failed');
        if (active.length === 0 || iteration > 3) {
          console.error(`[orchestrator] Circuit breaker: task states unchanged for consecutive iterations. Stopping.`);
          break;
        }
      }
      lastStateHash = stateHash;

      // Fail tasks whose dependencies failed
      for (const task of allTasks.filter(t => t.status === 'pending')) {
        const failedDep = task.depends_on.find(depId => {
          const dep = allTasks.find(t => t.id === depId);
          return dep?.status === 'failed';
        });
        if (failedDep) {
          await this.taskManager.updateStatus(task.id, 'failed');
        }
      }

      if (await this.taskManager.isAllComplete()) break;

      const readyTasks = allTasks.filter(t => {
        if (t.status !== 'pending') return false;
        return t.depends_on.every(depId => allTasks.find(x => x.id === depId)?.status === 'done');
      });

      const inProgress = allTasks.filter(t => t.status === 'in_progress' && !dispatched.has(t.id));
      const toRun = [...inProgress];

      if (readyTasks.length > 0) {
        await this.assignTasks(readyTasks);
        const refreshed = await this.taskManager.getTasks();
        const newlyReady = refreshed.filter(t =>
          readyTasks.some(r => r.id === t.id) && t.status === 'in_progress' && !dispatched.has(t.id)
        );
        toRun.push(...newlyReady);
      }

      if (toRun.length > 0) {
        console.log(`  [wave ${iteration}] starting ${toRun.map(t => t.id).join(', ')}`);
        toRun.forEach(t => dispatched.add(t.id));
        await Promise.all(toRun.map(t => this._runTask(t)));
        toRun.forEach(t => dispatched.delete(t.id));
      } else {
        const s = await this.taskManager.getSummary();
        console.log(`  [iter ${iteration}/${maxIterations}] done=${s.done} running=${s.in_progress} pending=${s.pending} failed=${s.failed} elapsed=${Math.round(elapsed / 1000)}s`);
        await new Promise(r => setTimeout(r, this.pollIntervalMs));
      }
    }
  }
```

---

## Bug R3: max_retries=3 Causes 6 Retry Cycles Before Failure

**Root cause**: `_normalise()` in `src/taskmanager/index.js:299` sets `max_retries: data.max_retries ?? 3`. With 2 agents, the force-assign fallback in the router means up to 6 retries (3 per agent).

**Fix**: Change default from 3 to 1.

**File to modify**: `src/taskmanager/index.js`

**Current code at line 299**:
```javascript
      max_retries: data.max_retries ?? 3,
```

**Change to**:
```javascript
      max_retries: data.max_retries ?? 1,
```

**ALSO change line 72** (the `addTask` method):
```javascript
      max_retries: task.max_retries ?? 3,
```
**Change to**:
```javascript
      max_retries: task.max_retries ?? 1,
```

**ALSO change the schema default** in `src/taskmanager/schema.sql`, line 15:
```sql
  max_retries     INTEGER DEFAULT 3,
```
**Change to**:
```sql
  max_retries     INTEGER DEFAULT 1,
```

**IMPORTANT**: Some existing tests may assert `max_retries === 3`. After changing the default, search all test files for `max_retries` and update assertions from `3` to `1`:
```bash
grep -rn 'max_retries' src/ tests/
```
Fix any test that asserts `max_retries` equals `3` to assert `1` instead.

---

## Bug R4: Dead `retryTask()` Call in `_runTask` Catch Block

**Root cause**: In `src/orchestrator/core.js:393-402`, `_runTask()`'s catch block calls `retryTask(task.id)`. But `retryTask()` checks `task.status !== 'failed'` — at this point the task is still `in_progress`, so it ALWAYS returns null. The real retry happens inside `updateStatus('failed')` which has its own auto-retry logic. The `retryTask()` call is dead code.

**Fix**: Remove the dead `retryTask()` call. Just call `updateStatus('failed')` directly.

**File to modify**: `src/orchestrator/core.js`

**Current code at lines 393-402**:
```javascript
    } catch (err) {
      console.error(`  [error] ${task.id}: ${err.message}`);
      // Attempt retry
      const retried = await this.taskManager.retryTask(task.id);
      if (retried) {
        console.log(`  [retry] ${task.id} (attempt ${retried.retries})`);
      } else {
        await this.taskManager.updateStatus(task.id, 'failed').catch(() => {});
      }
    }
```

**Replace with**:
```javascript
    } catch (err) {
      console.error(`  [error] ${task.id}: ${err.message}`);
      // updateStatus('failed') handles auto-retry internally if retries < max_retries
      await this.taskManager.updateStatus(task.id, 'failed').catch(() => {});
    }
```

---

## Bug R5: No Progress Logging — Silent 2s Polls Give Zero Visibility

**Root cause**: The execution loop's else branch (when no tasks are ready) only logs a one-liner summary every 2 seconds. During Docker runs (up to 300s), the orchestrator is silent. There's no indication of what's happening.

**This is already addressed by the R2 fix above** — the new `executeTasks()` logs iteration numbers, elapsed time, and task states. No additional code change needed for R5 beyond what R2 provides.

---

## Tests to Write

Create a new test file: `src/orchestrator/orchestrator.test.js`

Use the same patterns as `src/taskmanager/taskmanager.test.js`:
- `node:test` (describe, it, before, after)
- `node:assert/strict`
- `makeTestEnv()` for isolated temp dirs

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { TaskManager } from '../taskmanager/index.js';

async function makeTestEnv() {
  const dir = join(tmpdir(), `orch-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const manager = new TaskManager(dir);
  await manager.initialize();
  return { dir, manager, cleanup: async () => { await rm(dir, { recursive: true, force: true }); } };
}

// ── R1: TASK_CONTEXT.md cleanup ──
describe('R1: TASK_CONTEXT.md is deleted before auto-commit', () => {
  it('rm(TASK_CONTEXT.md) removes the file from worktree', async () => {
    const dir = join(tmpdir(), `r1-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const ctxPath = join(dir, 'TASK_CONTEXT.md');
    await writeFile(ctxPath, '# test context');
    assert.ok(existsSync(ctxPath));
    await rm(ctxPath, { force: true });
    assert.ok(!existsSync(ctxPath));
    await rm(dir, { recursive: true, force: true });
  });
});

// ── R2: Circuit breaker ──
describe('R2: executeTasks circuit breaker', () => {
  // We can't easily test the full executeTasks without Docker,
  // but we can verify the circuit breaker parameters exist
  // and that isAllComplete works correctly for the exit condition.

  it('isAllComplete returns true when all tasks are done or failed', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test', type: 'code' });
      assert.equal(await manager.isAllComplete(), false);
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress');
      assert.equal(await manager.isAllComplete(), false);
      await manager.updateStatus('T1', 'done');
      assert.equal(await manager.isAllComplete(), true);
    } finally { await cleanup(); }
  });

  it('isAllComplete returns true when mix of done and failed', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test1', type: 'code', max_retries: 0 });
      await manager.addTask({ id: 'T2', title: 'test2', type: 'code' });
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress');
      await manager.updateStatus('T1', 'failed'); // max_retries=0, stays failed
      await manager.claimTask('T2', 'gemini');
      await manager.updateStatus('T2', 'in_progress');
      await manager.updateStatus('T2', 'done');
      assert.equal(await manager.isAllComplete(), true);
    } finally { await cleanup(); }
  });
});

// ── R3: max_retries default is 1 ──
describe('R3: max_retries default changed to 1', () => {
  it('addTask defaults max_retries to 1', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      const task = await manager.addTask({ id: 'T1', title: 'test', type: 'code' });
      assert.equal(task.max_retries, 1);
    } finally { await cleanup(); }
  });

  it('addTasks defaults max_retries to 1', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      const tasks = await manager.addTasks([
        { id: 'T1', title: 'test', type: 'code' },
      ]);
      const t1 = tasks.find(t => t.id === 'T1');
      assert.equal(t1.max_retries, 1);
    } finally { await cleanup(); }
  });

  it('explicit max_retries=5 is preserved', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      const task = await manager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 5 });
      assert.equal(task.max_retries, 5);
    } finally { await cleanup(); }
  });
});

// ── R4: updateStatus(failed) handles retry ──
describe('R4: updateStatus(failed) auto-retries correctly', () => {
  it('failed task with retries < max_retries goes back to pending', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 2 });
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress', { assigned_to: 'gemini' });
      const after = await manager.updateStatus('T1', 'failed');
      assert.equal(after.status, 'pending', 'should auto-retry to pending');
      assert.equal(after.retries, 1);
      assert.deepEqual(after.previous_agents, ['gemini']);
      assert.equal(after.assigned_to, null);
    } finally { await cleanup(); }
  });

  it('failed task with retries >= max_retries stays failed', async () => {
    const { manager, cleanup } = await makeTestEnv();
    try {
      await manager.addTask({ id: 'T1', title: 'test', type: 'code', max_retries: 0 });
      await manager.claimTask('T1', 'gemini');
      await manager.updateStatus('T1', 'in_progress');
      const after = await manager.updateStatus('T1', 'failed');
      assert.equal(after.status, 'failed', 'should stay failed');
    } finally { await cleanup(); }
  });
});
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/orchestrator/core.js` | R1: delete TASK_CONTEXT.md before auto-commit (lines 379-384) |
| `src/orchestrator/core.js` | R2: replace executeTasks() with circuit-breaker version (lines 207-254) |
| `src/orchestrator/core.js` | R4: simplify _runTask catch block (lines 393-402) |
| `src/taskmanager/index.js` | R3: change max_retries default from 3 to 1 (lines 72, 299) |
| `src/taskmanager/schema.sql` | R3: change DEFAULT 3 to DEFAULT 1 (line 15) |

## Files to Create

| File | Purpose |
|------|---------|
| `src/orchestrator/orchestrator.test.js` | Tests for R1, R2, R3, R4 |

## Files You Must NOT Modify

- `src/mcp-server/index.js`
- `src/mcp-server/tools.js`
- `src/docker/runner.js`
- `src/worktree/index.js`
- `src/router/index.js`
- `src/tracker/index.js`
- Any existing `.test.js` files (except updating `max_retries` assertions from 3 to 1)

---

## Step-by-Step Execution Order

1. **Read** the files listed in "Files to Modify" to confirm current code matches what's described above.
2. **Apply R1** — add `TASK_CONTEXT.md` deletion in `_runTask()` before `_autoCommit()`.
3. **Apply R2** — replace `executeTasks()` method entirely.
4. **Apply R3** — change all three `max_retries` defaults (schema.sql, index.js line 72, index.js line 299).
5. **Apply R4** — simplify the `_runTask()` catch block.
6. **Search for tests asserting max_retries === 3** and update them:
   ```bash
   grep -rn 'max_retries.*3\|max_retries, 3' src/ tests/
   ```
7. **Create** `src/orchestrator/orchestrator.test.js` with the test code above.
8. **Run `npm test`** — expect 77 + ~8 new = ~85 tests, 0 failures.
9. **Commit** all changes:
   ```bash
   git add -A && git commit -m "fix: orchestrator reliability — circuit breaker, retry defaults, context cleanup (R1-R5)"
   ```

---

## Acceptance Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| AC1 | `TASK_CONTEXT.md` is deleted from worktree before auto-commit | Read `_runTask()` in core.js — `rm(ctxPath)` appears before `_autoCommit()` |
| AC2 | `executeTasks()` has circuit breaker with maxIterations and totalTimeoutMs | Read method signature — accepts options, has `if (iteration > maxIterations) break` |
| AC3 | `executeTasks()` detects stuck state (unchanged task states) | Read method — `stateHash === lastStateHash` check exists |
| AC4 | `executeTasks()` logs iteration number and elapsed time | Read log lines — include `[wave ${iteration}]` and `elapsed=` |
| AC5 | Default `max_retries` is 1 in schema.sql, addTask, and _normalise | `grep -n 'max_retries.*1' src/taskmanager/schema.sql src/taskmanager/index.js` shows 3 matches |
| AC6 | Dead `retryTask()` call removed from `_runTask` catch block | `grep -n 'retryTask' src/orchestrator/core.js` returns 0 matches |
| AC7 | New test file exists at `src/orchestrator/orchestrator.test.js` | `ls src/orchestrator/orchestrator.test.js` succeeds |
| AC8 | `npm test` passes with 0 failures and >= 83 tests | Output shows `fail 0` and `tests >= 83` |
| AC9 | No existing tests broken | All 77 original tests still pass |
| AC10 | All changes committed to master | `git status` is clean, `git log --oneline -1` shows the commit |

## Definition of Done

ALL of the following must be true:
- `npm test` output: **0 failures**, **>= 83 tests**
- `git status` is **clean** (everything committed)
- `git diff HEAD~1 --stat` shows only the files listed in "Files to Modify" and "Files to Create"
- The commit message is: `fix: orchestrator reliability — circuit breaker, retry defaults, context cleanup (R1-R5)`
