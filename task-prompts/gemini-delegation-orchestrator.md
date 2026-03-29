# GEMINI-02 — Orchestrator: Host-Led delegate() + MCP Wiring

## Objective

Implement host-led delegation: the Tech Lead calls `delegate()` via MCP, the orchestrator
creates a child task, runs it through the existing `_runTask()` pipeline, and blocks until
the child completes. Add MCP tools for delegation and subagent discovery.

## Owned Files

**Modify:**
- `src/orchestrator/core.js`
- `src/mcp-server/tools.js`
- `src/mcp-server/index.js`

**Do not touch:**
- `src/taskmanager/` (schema and state machine are stable)
- `src/router/`
- `src/docker/runner.js`
- `src/worktree/`

---

## Required Changes

### 1. `Orchestrator.delegate(subagentName, prompt, type, parentTaskId, opts)` — new method

```js
/**
 * Host-led delegation: create a child task and execute it synchronously.
 *
 * @param {string} subagentName — logical role to delegate to ('gemini', 'claude-code', 'codex')
 * @param {string} prompt — the task description/instructions
 * @param {string} [type='code'] — task type hint ('code'|'research'|'analysis'|...)
 * @param {string|null} [parentTaskId=null] — ID of the parent task spawning this child
 * @param {Object} [opts={}]
 * @param {boolean} [opts.mergeBack=true] — auto merge-back for non-research tasks
 * @returns {Promise<TaskResultData>} canonical result envelope
 */
async delegate(subagentName, prompt, type = 'code', parentTaskId = null, opts = {})
```

**Implementation steps inside `delegate()`:**

1. **Validate subagentName** — must exist in `this.agents`. If not: throw `Error: Unknown subagent: ${subagentName}`.

2. **Resolve delegate_depth** — if `parentTaskId` is provided, load the parent task and use `parent.delegate_depth + 1`. If no parent, `delegate_depth = 0`. Import `MAX_DELEGATE_DEPTH` from `../taskmanager/index.js` and enforce it:
   ```js
   import { TaskManager, MAX_DELEGATE_DEPTH } from '../taskmanager/index.js';
   // ...
   if (delegateDepth > MAX_DELEGATE_DEPTH) throw new Error(`delegate_depth limit exceeded (max ${MAX_DELEGATE_DEPTH})`);
   ```

3. **Create child task** via `this.taskManager.createDelegatedTask(parentTaskId, { ... })`:
   ```js
   const childTask = await this.taskManager.createDelegatedTask(parentTaskId, {
     id: `D-${randomUUID().slice(0, 8)}`,
     job_id: parentTask?.job_id ?? null,
     title: prompt.slice(0, 80),
     description: prompt,
     type: type ?? 'code',
     subagent_name: subagentName,
     routing_reason: 'host_delegated',
   });
   ```
   If `parentTaskId` is null, fall back to `this.taskManager.addTask({ ..., is_delegated: true, delegate_depth: 0 })`.

4. **Assign to agent** — assign directly to `subagentName` (bypass quota routing for explicit delegation):
   ```js
   await this.taskManager.claimTask(childTask.id, subagentName);
   await this.taskManager.updateStatus(childTask.id, 'in_progress', {
     worktree_branch: this.worktreeManager.branchName(childTask.id, subagentName),
     assigned_to: subagentName,
   });
   ```

5. **Execute via `_runTask()`** — call `await this._runTask(childTask)` to run the child in Docker. This is synchronous from the caller's perspective (awaited).

6. **Build result envelope** — after `_runTask()` returns, reload the task from DB:
   ```js
   const done = await this.taskManager.getTask(childTask.id);
   const resultData = done.result_data ?? {
     summary: done.status === 'done' ? 'Task completed' : 'Task failed',
     provider: subagentName,
     model: null,
     files_changed: [],
     duration_ms: 0,
   };
   ```

7. **Merge-back** — for non-research tasks with `opts.mergeBack !== false` and `done.status === 'done'`:
   ```js
   const isResearch = ['research', 'analysis', 'docs'].includes(type);
   if (!isResearch && opts.mergeBack !== false && done.status === 'done') {
     try {
       await this.acceptTask(childTask.id);
       resultData.merged = true;
     } catch (mergeErr) {
       resultData.merged = false;
       resultData.merge_error = mergeErr.message;
       // Do not throw — surface in result, let caller decide
     }
   }
   ```

8. **Return `resultData`**.

---

### 2. New MCP tool: `delegate`

Add to `TOOLS` array in `src/mcp-server/tools.js`:

```js
{
  name: 'delegate',
  description: 'Delegate a task to a specific subagent and block until it completes. Returns the result envelope. Use this to hand off well-scoped work to a specialist (gemini for research/analysis, claude-code for precision code, codex for broad refactoring).',
  inputSchema: {
    type: 'object',
    properties: {
      subagent_name: {
        type: 'string',
        description: 'Agent to delegate to: "gemini", "claude-code", or "codex"',
      },
      prompt: {
        type: 'string',
        description: 'Full task description / instructions for the subagent',
      },
      type: {
        type: 'string',
        enum: ['code', 'refactor', 'test', 'review', 'debug', 'research', 'docs', 'analysis'],
        description: 'Task type hint. Determines whether merge-back runs (research/analysis/docs skip merge).',
        default: 'code',
      },
      parent_task_id: {
        type: 'string',
        description: 'ID of the parent task that is delegating (optional). Used for delegation depth tracking.',
      },
    },
    required: ['subagent_name', 'prompt'],
  },
},
```

### 3. New MCP tool: `list_subagents`

Add to `TOOLS` array in `src/mcp-server/tools.js`:

```js
{
  name: 'list_subagents',
  description: 'List all configured subagents with their capabilities, quota, and current availability.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
},
```

### 4. Wire new tools in `handleTool` — `src/mcp-server/tools.js`

Add to the `switch` in `handleTool`:

```js
case 'delegate': {
  const result = await orchestrator.delegate(
    args.subagent_name,
    args.prompt,
    args.type ?? 'code',
    args.parent_task_id ?? null,
  );
  return { result };
}

case 'list_subagents': {
  const agents = Array.from(orchestrator.agents.entries()).map(([name, cfg]) => ({
    name,
    capabilities: cfg.capabilities,
    quota: cfg.quota,
    concurrency: cfg.concurrency ?? 1,
    image: cfg.image,
  }));
  return { subagents: agents };
}
```

### 5. Extend `task_status` response

In the `case 'task_status':` handler, when returning a single task, include delegation metadata:
```js
// Add these fields to the returned task object:
// subagent_name, provider, model, parent_task_id, delegate_depth, is_delegated,
// routing_reason, result_data
// These are already on the task object from the DB — just ensure they aren't stripped.
```

The current handler returns `{ task }` where `task` is the raw DB row. Verify no fields are stripped. If the `task_status` handler maps fields explicitly, add the delegation fields to that mapping. If it returns the full object, no change is needed.

### 6. Extend `workforce_status` response

In `getWorkforceStatus()` in `core.js`, add delegation stats to each agent entry:
```js
{
  agent: name,
  status: ...,
  utilization: ...,
  load_percent: ...,
  // add:
  active_delegations: /* count of is_delegated=1 AND assigned_to=name AND status IN ('in_progress','claimed') */,
}
```

Use a single SQL count query: do not add a new TaskManager method for this — use `this.taskManager.db.prepare(...).get(name)` directly in `getWorkforceStatus()`.

---

## Implementation Notes

- `delegate()` is synchronous from MCP perspective (it awaits the child task). This is by design — host-led delegation blocks the caller until the child finishes.
- Do NOT implement HTTP server, IPC, or container-to-host communication. That is a future phase.
- The `_runTask()` path already handles Docker container lifecycle, worktree creation, and result parsing. Reuse it unchanged.
- For research/analysis/docs type tasks, `acceptTask()` is NOT called (no code was written, nothing to merge).
- If child task fails (`done.status === 'failed'`), return the result envelope with failed status — do NOT throw. Let the caller decide whether to retry or escalate.

---

## Definition of Done

- [ ] `Orchestrator.delegate()` implemented in `src/orchestrator/core.js`
- [ ] `delegate` MCP tool defined in `src/mcp-server/tools.js` with correct schema
- [ ] `list_subagents` MCP tool defined and wired
- [ ] `task_status` returns delegation metadata fields
- [ ] `workforce_status` includes `active_delegations` per agent
- [ ] `npm test` → 0 failures (all existing tests still pass)
- [ ] No new test file required for this task (integration tests are Codex's slice)
