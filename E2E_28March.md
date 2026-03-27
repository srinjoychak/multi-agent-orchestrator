# E2E Session Plan — 28 March 2026

**Goal: One successful 3-task job through the full MCP pipeline. Zero manual interventions.**

---

## Context (read DESIGN.md + PROMPT_NEXT_SESSION.md for full detail)

The orchestrator is built and unit-tested (122 tests, 0 failures). The gemini Docker worker
is proven to write code and commit correctly. We have never run a full end-to-end job.
Today we fix the 2 things that will break E2E before it starts, then run the real thing.

---

## Fix 1 — Worktree cleanup (20 min)

**Why it blocks E2E:** 3 orphan worktrees from previous sessions are still registered.
If orchestrate() produces a task with the same ID, `git worktree add` will fail.

**Verify the problem first:**
```bash
git worktree list
# Expect: 3 stale .worktrees/... entries
```

**Fix A — Prune on reject** (`src/orchestrator/core.js`):
```js
async rejectTask(taskId, reason) {
  const task = await this.taskManager.getTask(taskId);
  if (task.assigned_to) {
    await this.worktreeManager.prune(taskId, task.assigned_to).catch(() => {});
  }
  return this.taskManager.rejectTask(taskId, reason);
}
```

**Fix B — End-of-job sweep** (`src/orchestrator/core.js executeTasks()`):
After the while loop exits, prune worktrees for all failed tasks:
```js
const finalTasks = jobId
  ? await this.taskManager.getJobTasks(jobId)
  : await this.taskManager.getTasks();
for (const t of finalTasks.filter(t => t.status === 'failed' && t.assigned_to)) {
  await this.worktreeManager.prune(t.id, t.assigned_to).catch(() => {});
}
```

**Fix C — reset-state also nukes worktrees** (`package.json`):
```json
"reset-state": "npm run kill-mcp 2>/dev/null; git worktree list --porcelain | grep '^worktree ' | grep '.worktrees' | awk '{print $2}' | xargs -r git worktree remove --force 2>/dev/null; git branch -D $(git branch --list 'agent/*' | tr -d ' +*') 2>/dev/null; rm -rf ~/.local/share/multi-agent-orchestrator-v3 && echo 'State cleared'"
```

**Verify fix:**
```bash
npm run reset-state
git worktree list      # should show ONLY the main worktree
git branch | grep agent/   # should be empty
```

---

## Fix 2 — task_reset MCP tool (20 min)

**Why it blocks E2E:** `reset-state` deletes the DB file but the running MCP server
still holds the old SQLite connection open. New orchestrate() calls operate on stale
in-memory state. You currently have to reboot WSL2 to get a clean slate.

**Fix in `src/mcp-server/tools.js`** — add to TOOLS array:
```js
{
  name: 'task_reset',
  description: 'Clear all tasks and jobs from the database without restarting the server.',
  inputSchema: { type: 'object', properties: {} },
}
```

**Fix in handleTool switch:**
```js
case 'task_reset': {
  orchestrator.taskManager.clear();
  await orchestrator.worktreeManager.reset();
  return { cleared: true, message: 'All tasks, jobs, and worktrees cleared.' };
}
```

**Verify:**
```bash
# Call via MCP: task_reset()
# Then: task_status() should return empty board
```

---

## Clean Start Checklist (do this before E2E)

```bash
# 1. Pull latest master
git checkout master && git pull

# 2. Create feature branch for today's work
git checkout -b feat/e2e-28march

# 3. Clear state (kills MCP server + wipes DB + removes worktrees)
npm run reset-state

# 4. Confirm clean git state
git worktree list          # only main
git branch | grep agent/   # empty

# 5. MCP server will restart automatically via Claude Code settings.local.json
#    OR start manually:
#    node src/mcp-server/index.js &
#    Wait for: "[mcp-server] Orchestrator MCP server running on stdio"

# 6. Verify MCP is live
task_status()              # should return { summary: { total: 0 } }
```

---

## The E2E Run

Pick a **real task from your actual project**. Not test infrastructure. Something you
need built. Feed it to `orchestrate()`. Let the workforce do it. That is the test.

If you don't have a ready task, use this as a proxy — it exercises parallel execution,
file writing, and real code:

> "Build a simple Express REST API with 3 endpoints: GET /health, GET /tasks (returns
> mock list), POST /tasks (accepts {title, type} and returns created task with UUID).
> Include input validation, a basic test file using node:test, and a README."

### Monitoring during the run

```
# In a second terminal / second Claude Code window:
task_status()              # poll every 30s to see task board
task_logs(<id>)            # if a task seems stuck
workforce_status()         # see which containers are running
```

### Review and merge

For each completed task:
1. `task_diff(<id>)` — read the diff carefully
2. If good: `task_accept(<id>)` — merges into feat/e2e-28march, prunes worktree
3. If bad: `task_reject(<id>, "<specific reason>")` — re-queues for next agent

### Finish

```bash
npm test                   # must be 0 failures before merging
git checkout master
git merge --no-ff feat/e2e-28march -m "feat: e2e verified — <what was built>"
```

---

## Definition of Done for This Session

- [ ] `npm run reset-state` leaves a clean git state (no orphan worktrees, no agent branches)
- [ ] `task_reset()` MCP tool clears the board without a server restart
- [ ] A 3-task job completes end-to-end — tasks dispatched, executed in Docker, diffs reviewed, branches merged
- [ ] Gemini produced actual working code (not empty diffs, not placeholder files)
- [ ] `npm test` passes after merge
- [ ] No direct commits to master

---

## If Things Break

| Symptom | Fix |
|---------|-----|
| `git worktree add` fails with "already exists" | `npm run reset-state` or `task_reset()` |
| MCP server unresponsive | `npm run kill-mcp && node src/mcp-server/index.js &` |
| Task stuck in `claimed` for >10 min | `task_kill(<id>)` then `task_status()` — it will auto-reset to pending |
| Gemini produces empty diff | `task_reject(<id>, "No files were changed. Read the task description fully and write all required files.")` |
| Container exits immediately (exit code 1) | `task_logs(<id>)` — usually a prompt parsing issue or missing auth |
| WSL2 SQLite I/O error | stateDir is on wrong filesystem — check `~/.local/share/` not `/mnt/d/` |
