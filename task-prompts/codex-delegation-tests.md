# CODEX-02 — Integration + Edge Case Tests for Delegation

## Objective

Write the integration and edge-case test suite for the host-led delegation feature.
Use mocks for Docker and worktree operations — tests must run without Docker.
Tests are written against the API contracts defined in CLAUDE-02 and GEMINI-02.

## Owned Files

**Create:**
- `tests/integration/delegation.integration.test.js`
- `tests/integration/delegation-mocks.js`

**Do not touch:**
- `src/` (any source file)
- `tests/integration/helpers.js`
- `tests/integration/taskmanager.integration.test.js`

---

## API Contract (from CLAUDE-02 and GEMINI-02)

These are the APIs your tests exercise. Do not re-implement them — import and call them.

### TaskManager (from `src/taskmanager/index.js`)

```js
// Already shipped in CLAUDE-01 + CLAUDE-02:
tm.createDelegatedTask(parentTaskId, opts)  // → Promise<task>
tm.getDelegatedTasks(parentTaskId)          // → Promise<task[]>
tm.getTaskTree(rootTaskId)                  // → Promise<task[]>
MAX_DELEGATE_DEPTH                          // exported constant, value = 3
```

### Orchestrator (from `src/orchestrator/core.js`)

```js
// From GEMINI-02:
orchestrator.delegate(subagentName, prompt, type, parentTaskId, opts)
// → Promise<TaskResultData>
// TaskResultData: { summary, provider, model, files_changed, duration_ms, merged?, merge_error? }
```

---

## Mock Strategy

Tests must NOT require Docker or running containers. Use the mock pattern below.

### `tests/integration/delegation-mocks.js`

```js
import { EventEmitter } from 'node:events';

/**
 * Returns a mock DockerRunner that resolves _run() immediately with predefined stdout.
 * Pass `behavior: 'success'` | 'failure' | 'timeout'
 */
export function makeMockDockerRunner(behavior = 'success') { ... }

/**
 * Returns a mock WorktreeManager that skips git operations.
 * create() returns a temp dir path. merge() returns { success: true }.
 * prune() is a no-op.
 */
export function makeMockWorktreeManager(tmpDir) { ... }
```

The mock `DockerRunner._run()` should:
- `'success'`: return stdout that matches the Claude JSON output format:
  ```json
  {"type":"result","subtype":"success","result":"Task complete","cost_usd":0.01,"session_id":"mock"}
  ```
- `'failure'`: return exit code 1 with stderr `"mock container failure"`
- `'timeout'`: never resolve (test uses a short `timeoutMs` to trigger circuit breaker)

Mock worktree manager:
```js
{
  create: async (taskId, agentName) => ({ path: join(tmpDir, taskId), branch: `task/${taskId}` }),
  merge:  async (taskId, agentName) => ({ success: true, branch: `task/${taskId}` }),
  prune:  async () => {},
  diff:   async () => '',
  branchName: (taskId, agentName) => `task/${taskId}-${agentName}`,
  changedFiles: async () => [],
  reset:  async () => {},
}
```

---

## Test File: `tests/integration/delegation.integration.test.js`

Use `node:test` + `node:assert/strict`. Each test gets a fresh `makeTmpDir()` from `./helpers.js`.

### Section 1 — TaskManager delegation methods (no Docker needed)

These tests use TaskManager directly — no Orchestrator or Docker.

```
test('createDelegatedTask sets is_delegated, parent_task_id, delegate_depth=1')
test('createDelegatedTask depth 1 → 2 → 3 succeeds; depth 4 throws')
test('createDelegatedTask throws if parent not found')
test('getDelegatedTasks returns only direct children, not grandchildren')
test('getTaskTree returns root + all descendants ordered by depth')
test('getTaskTree root-only returns single-element array')
```

### Section 2 — Orchestrator.delegate() with mocks

These tests construct an `Orchestrator` with mocked DockerRunner + WorktreeManager injected.
You will need to expose a way to inject mocks. Use constructor options or direct property assignment after construction — check `src/orchestrator/core.js:85-103` for the constructor.

If the constructor does not accept injection, assign after `initialize()`:
```js
const orch = new Orchestrator(dir, { stateDir: dir });
await orch.initialize({ quiet: true });
orch.docker = makeMockDockerRunner('success');
orch.worktreeManager = makeMockWorktreeManager(dir);
```

**Required tests:**

```
test('delegate() creates child task with is_delegated=true, correct parent_task_id')
test('delegate() returns result envelope with provider, summary, files_changed')
test('delegate() with type=research skips merge-back')
test('delegate() with type=code calls acceptTask (merge-back)')
test('delegate() when child task fails returns failed result, does not throw')
test('delegate() with unknown subagent_name throws')
test('delegate() exceeding MAX_DELEGATE_DEPTH throws at createDelegatedTask')
```

### Section 3 — Orphan recovery

These tests use TaskManager directly (no Docker).

```
test('orphan: is_delegated in_progress tasks are failed on startup with routing_reason=orchestrator_restart')
test('orphan: non-delegated in_progress tasks are untouched by orphan recovery')
test('orphan: failed tasks stay failed after second restart (no double-processing)')
```

### Section 4 — MCP tool contract (schema validation only, no server needed)

Import `TOOLS` from `src/mcp-server/tools.js` and validate schemas.
No server startup, no HTTP — just validate that the tool definitions match the contract.

```
test('TOOLS includes delegate with required fields: subagent_name, prompt')
test('TOOLS includes list_subagents with empty inputSchema')
test('task_status tool schema has optional id field')
```

---

## Running Tests

```bash
node --test tests/integration/delegation.integration.test.js
```

All tests must pass with 0 failures.

`npm test` must also still be 0 failures (do not break existing tests).

---

## Important Constraints

1. **No real Docker.** If any test requires Docker to be running to pass, it is wrong — rewrite it with mocks.
2. **No shared state between tests.** Each test gets its own `mkdtempSync` + `rmSync` in a `finally` block.
3. **No `setTimeout` or sleep.** If you need to simulate async work, resolve immediately.
4. **Mock the minimum.** Only mock `DockerRunner` and `WorktreeManager`. Everything else (TaskManager, Router, AgentRouter) uses real implementations.
5. **Test behavior, not implementation.** Assert on task field values, return shapes, thrown error messages — not on internal method call counts.

---

## Definition of Done

- [ ] `tests/integration/delegation-mocks.js` — `makeMockDockerRunner`, `makeMockWorktreeManager` exported
- [ ] `tests/integration/delegation.integration.test.js` — all 4 sections, minimum 16 tests
- [ ] `node --test tests/integration/delegation.integration.test.js` → 0 failures
- [ ] `npm test` → 0 failures (full suite still green)
- [ ] No test requires Docker to be running
