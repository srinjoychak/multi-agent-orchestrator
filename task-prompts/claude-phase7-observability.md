# CLAUDE-03 — Phase 7: Observability — task_diff header + task_status filter

## Objective

Two targeted observability improvements:
1. `task_diff` response includes a header showing `provider`, `model`, `subagent_name`, `delegate_depth` before the raw diff
2. `task_status` accepts an optional `subagent_name` filter to list tasks by delegation role

## Owned Files

**Modify:**
- `src/mcp-server/tools.js`
- `src/taskmanager/index.js`

**Do not touch:**
- `src/orchestrator/core.js`
- `src/mcp-server/index.js`
- `src/worktree/`
- Any test file

---

## Change 1 — task_diff header (src/mcp-server/tools.js)

### Schema addition

In the `task_diff` tool definition in `TOOLS`, no input schema change needed (takes `id` as before).

### handleTool change

In `case 'task_diff':`, enrich the returned object with a delegation header.

Current return (line ~165):
```js
return { task_id: args.id, files_changed: files, diff };
```

Replace with:
```js
const header = [
  task.subagent_name  ? `subagent:  ${task.subagent_name}`  : null,
  task.provider       ? `provider:  ${task.provider}`       : null,
  task.model          ? `model:     ${task.model}`           : null,
  task.delegate_depth != null ? `depth:     ${task.delegate_depth}` : null,
  task.parent_task_id ? `parent:    ${task.parent_task_id}` : null,
  task.routing_reason ? `routed:    ${task.routing_reason}` : null,
].filter(Boolean).join('\n');

const annotatedDiff = header ? `${header}\n\n${diff}` : diff;
return { task_id: args.id, files_changed: files, diff: annotatedDiff };
```

Note: `task` is already loaded earlier in the case block (`const task = await orchestrator.taskManager.getTask(args.id)`). Use that existing variable — do not add a second DB read.

---

## Change 2 — task_status subagent_name filter (src/mcp-server/tools.js + src/taskmanager/index.js)

### Schema addition (tools.js)

In the `task_status` tool definition in `TOOLS`, add `subagent_name` as an optional filter property:

```js
{
  name: 'task_status',
  description: 'Get the status of all tasks, a specific task by ID, or all tasks for a given subagent role.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Task ID (e.g. "T1"). Omit for all tasks or use subagent_name filter.',
      },
      subagent_name: {
        type: 'string',
        description: 'Filter by subagent role (e.g. "gemini", "researcher"). Returns all tasks assigned to this role.',
      },
    },
  },
},
```

### handleTool change (tools.js)

In `case 'task_status':`, add the filter branch before the existing `if (args.id)` check:

```js
case 'task_status': {
  if (args.id) {
    const task = await orchestrator.taskManager.getTask(args.id);
    return { task };
  }
  if (args.subagent_name) {
    const tasks = await orchestrator.taskManager.getTasksBySubagent(args.subagent_name);
    return { subagent_name: args.subagent_name, count: tasks.length, tasks };
  }
  const tasks = await orchestrator.taskManager.getTasks();
  const summary = await orchestrator.taskManager.getSummary();
  return { summary, tasks };
}
```

### New method: TaskManager.getTasksBySubagent(subagentName) (src/taskmanager/index.js)

Add after `getTasksByAgent()`:

```js
/**
 * Return all tasks with the given subagent_name (logical delegation role).
 * @param {string} subagentName
 * @returns {Promise<Object[]>}
 */
async getTasksBySubagent(subagentName) {
  return this.db
    .prepare('SELECT * FROM tasks WHERE subagent_name = ? ORDER BY created_at')
    .all(subagentName)
    .map(r => this._deserialise(r));
}
```

---

## Acceptance Criteria

- `task_diff(id)` response `diff` field begins with the delegation header lines when `subagent_name`/`provider` are set on the task; no header when both are null
- `task_status({ subagent_name: "gemini" })` returns only tasks where `subagent_name = "gemini"`
- `task_status({ id: "T1" })` still works as before
- `task_status({})` still returns full board + summary
- `npm test` → 0 failures

---

## Definition of Done

- [ ] `task_diff` handleTool enriches diff with delegation header
- [ ] `task_status` inputSchema includes optional `subagent_name`
- [ ] `task_status` handleTool routes `subagent_name` filter to `getTasksBySubagent()`
- [ ] `TaskManager.getTasksBySubagent(name)` implemented in `src/taskmanager/index.js`
- [ ] `npm test` → 0 failures
