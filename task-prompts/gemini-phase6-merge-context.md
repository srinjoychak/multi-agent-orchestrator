# GEMINI-03 — Phase 6: Merge and Context Sync in delegate()

## Objective

Complete the delegation loop in `Orchestrator.delegate()` so that:
1. The parent worktree is auto-committed before the child runs (child sees parent's latest work)
2. The child worktree starts from the parent's current HEAD (not base branch)
3. Merge-back correctly detects conflicts, surfaces them in result_data, and skips prune on conflict

## Owned Files

**Modify only:**
- `src/orchestrator/core.js`

**Do not touch:**
- `src/worktree/index.js` — reuse `create()`, `merge()`, `diff()` as-is
- `src/taskmanager/`
- `src/mcp-server/`
- Any test file

---

## Current state of delegate() (lines ~532–612)

The method currently:
1. Creates child task
2. Claims + sets in_progress
3. Reloads from DB
4. Calls `_runTask(freshChild)`
5. Builds result envelope
6. Calls `this.acceptTask(childTask.id)` for merge-back
7. Persists result_data with raw SQL

Three gaps:

**Gap A** — No parent auto-commit before step 4. If the parent has uncommitted changes in its worktree, the child cannot see them because git worktrees branch from committed state.

**Gap B** — Child worktree is created by `_runTask()` → `worktreeManager.create()` which always branches from `_getBaseBranch()` (master/current Tech Lead branch). Child needs to branch from parent's worktree branch HEAD instead.

**Gap C** — `acceptTask()` swallows conflict info. When `worktreeManager.merge()` returns `{ success: false, conflicts: true }`, the child worktree MUST NOT be pruned — leave it so the Tech Lead can call `task_diff(child_id)` to inspect. Currently `acceptTask()` does not pass conflict info back, so it's lost.

---

## Required Changes

### 1. Auto-commit parent worktree (Gap A)

Between step 4 (updateStatus in_progress) and step 5 (reload + _runTask), add:

```js
// Phase 6 — auto-commit parent worktree so child can see uncommitted parent work
if (parentTaskId && parentTask?.worktree_branch) {
  const parentWorktreePath = this.worktreeManager.worktreePath(
    parentTaskId,
    parentTask.assigned_to ?? 'unknown'
  );
  if (existsSync(parentWorktreePath)) {
    // Unconditional — not "if dirty". Uncommitted parent work is invisible to git.
    await execFileAsync('git', ['-C', parentWorktreePath, 'add', '-A']).catch(() => {});
    await execFileAsync('git', [
      '-C', parentWorktreePath, 'commit', '--allow-empty', '-m',
      `chore: auto-snapshot before delegating ${childTask.id} to ${subagentName}`,
    ]).catch(() => {}); // no-op exit code if nothing to commit — that is fine
    log.info(`  [delegate] auto-committed parent worktree ${parentTaskId}`);
  }
}
```

### 2. Pre-create child worktree from parent HEAD (Gap B)

After the auto-commit block above, still before `_runTask()`:

```js
// Pre-create child worktree and reset it to parent's branch HEAD.
// worktreeManager.create() branches from _getBaseBranch() (Tech Lead's branch).
// We override this by creating the worktree, then resetting it to the parent branch.
// _runTask() calls create() internally but respects the existsSync guard — if the
// worktree directory already exists it just cleans untracked files, not reset HEAD.
if (parentTaskId && parentTask?.worktree_branch) {
  const childWorktreePath = this.worktreeManager.worktreePath(childTask.id, subagentName);
  if (!existsSync(childWorktreePath)) {
    await this.worktreeManager.create(childTask.id, subagentName); // branches from base
    // Reset child to parent's committed HEAD so child inherits parent's work
    await execFileAsync('git', [
      '-C', childWorktreePath, 'reset', '--hard', parentTask.worktree_branch,
    ]).catch(err => {
      log.error(`  [delegate] failed to reset child to parent HEAD: ${err.message}`);
    });
    log.info(`  [delegate] child worktree ${childTask.id} reset to parent branch ${parentTask.worktree_branch}`);
  }
}
```

### 3. Replace acceptTask() with direct merge for conflict awareness (Gap C)

Replace the current merge-back block:
```js
// OLD — swallows conflict info:
try {
  await this.acceptTask(childTask.id);
  resultData.merged = true;
} catch (mergeErr) {
  resultData.merged = false;
  resultData.merge_error = mergeErr.message;
}
```

With:
```js
// NEW — direct merge for conflict visibility
const mergeResult = await this.worktreeManager.merge(childTask.id, done.assigned_to ?? subagentName);
if (mergeResult.success) {
  // Clean merge — prune child worktree
  await this.worktreeManager.prune(childTask.id, done.assigned_to ?? subagentName).catch(() => {});
  resultData.merged = true;
  resultData.conflicts = false;
} else if (mergeResult.conflicts) {
  // Conflict — do NOT prune. Leave child worktree + branch so Tech Lead can task_diff(child_id).
  resultData.merged = false;
  resultData.conflicts = true;
  // Parse conflicting files from merge output message
  const conflictFiles = (mergeResult.message ?? '')
    .split('\n')
    .filter(l => l.includes('CONFLICT'))
    .map(l => l.replace(/^.*CONFLICT.*:\s*/, '').trim())
    .filter(Boolean);
  resultData.conflicting_files = conflictFiles.length > 0 ? conflictFiles : [];
  log.error(`  [delegate] merge conflict for ${childTask.id}: ${conflictFiles.length} files`);
} else {
  // Merge failed for non-conflict reason — surface error, don't prune
  resultData.merged = false;
  resultData.merge_error = mergeResult.message;
}
```

The raw SQL `result_data` persist call that follows stays unchanged.

---

## Acceptance Criteria

- `resultData.conflicts === false` and child worktree is pruned after a clean merge
- `resultData.conflicts === true` and `resultData.conflicting_files` is populated on conflict; child worktree still exists after delegate() returns
- `resultData.merged === true` only when merge succeeded
- Parent auto-commit runs before `_runTask()` when `parentTaskId` is provided and parent worktree exists
- Child worktree is reset to parent's branch HEAD when parent branch exists
- `npm test` → 0 failures (no regressions)

---

## Definition of Done

- [ ] Auto-commit block added before `_runTask()` call
- [ ] Child worktree pre-created and reset to parent HEAD when parent branch exists
- [ ] `acceptTask()` replaced with direct `worktreeManager.merge()` call
- [ ] `conflicts`, `conflicting_files`, `merged` correctly set in resultData
- [ ] Child worktree NOT pruned when `conflicts === true`
- [ ] `npm test` → 0 failures
