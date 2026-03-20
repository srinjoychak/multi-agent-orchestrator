# Gemini Agent Task List

Tasks assigned to Gemini to parallelize development of the Multi-Agent Orchestrator.
Each task is **self-contained** — complete them independently, in any order.
After finishing each task, run `npm test` to confirm no regressions.

---

## Task G1 — Unit tests for adapters

**File to create:** `src/adapters/adapters.test.js`

Write unit tests using Node.js built-in `node:test` + `assert` (same style as existing tests in this repo — see `src/taskmanager/taskmanager.test.js` for reference).

**Do NOT call real CLIs.** Mock `execFile`/`execFileAsync` where needed, or test pure methods directly.

### ClaudeCodeAdapter tests (`src/adapters/claude-code.js`)

- `buildArgs(task, context)` returns `['-p', <prompt>, '--output-format', 'json']`
- `_buildPrompt(task, context)` includes `task.title`, `task.description`, `context.workDir`, `context.branch`
- `parseOutput(stdout, stderr, duration_ms)`:
  - when stdout is valid JSON with `result` field → returns `{ status: 'done', summary: <result value>, ... }`
  - when stdout is valid JSON with `text` field → returns `{ status: 'done', summary: <text value>, ... }`
  - when stdout is valid JSON with `content` array of `{type:'text', text:'...'}` → concatenates text parts
  - when stdout is invalid JSON → falls back to raw text slice, still returns `status: 'done'`
  - always returns `duration_ms` matching the input
- `_extractFilesChanged(parsed)`:
  - when parsed has `files_changed` array → returns it
  - when parsed has `changes` array with `{file}` objects → maps to file strings
  - otherwise → returns `[]`

### GeminiAdapter tests (`src/adapters/gemini.js`)

- `buildArgs(task, context)` returns `['-p', <prompt>, '--output-format', 'json']`
- `parseOutput(stdout, stderr, duration_ms)`:
  - single JSON with `response` field → returns `{ status: 'done', summary: <response>, ... }`
  - single JSON with `candidates` array (`[{content:{parts:[{text:'hello'}]}}]`) → extracts text
  - newline-delimited JSON (stream format) → parses last event, extracts text
  - plain text fallback → returns `status: 'done'` with raw slice
- `_extractResultText(parsed)` handles all documented shapes without throwing

### AgentAdapter base tests (`src/adapters/base.js`)

- `isAvailable()` returns `true` when the command exits 0, `false` when it throws
- `execute()` calls `buildArgs`, passes result to `execFileAsync`, calls `parseOutput` with stdout/stderr/duration
- `execute()` returns `{ status: 'failed', summary: /timed out/ }` when `error.killed === true`
- `execute()` returns `{ status: 'failed', summary: /failed:/ }` on generic error
- `getEnvOverrides()` returns `{}` by default

---

## Task G2 — Unit tests for ResultMerger

**File to create:** `src/merger/merger.test.js`

Use `node:test` + `assert`. Mock git commands (`execFileAsync`) and filesystem where needed.
Use `os.tmpdir()` + unique subdir for any real filesystem operations.

### Tests required

- `collectResults()`:
  - returns `[]` when results directory does not exist
  - reads and parses all `.json` files in results dir, skips non-JSON files
  - silently skips corrupted (invalid JSON) files
- `mergeBranch(branchName)`:
  - returns `{ success: true, conflicts: [], output: <stdout> }` when git exits 0
  - returns `{ success: false, conflicts: [<file>], output: ... }` when stdout contains `CONFLICT`
  - calls `git merge --abort` after a conflict
- `mergeAll(tasks)`:
  - only attempts merge for tasks with `status === 'done'` and `worktree_branch` set
  - skips tasks with `status === 'failed'` or no `worktree_branch`
  - accumulates `merged` and `conflicted` arrays correctly
- `cleanupWorktree(worktreePath, branchName)`:
  - calls `git worktree remove <path> --force`
  - calls `git branch -D <branchName>` when branch name provided
  - does not throw if git commands fail (worktree already gone)
- `generateReport(tasks, mergeResult)`:
  - writes a `report.json` file to `agentTeamDir`
  - returned string includes task statuses, branch counts
  - `summary.total_tasks` equals `tasks.length`
- `_parseConflicts(output)`:
  - extracts file names from lines like `CONFLICT (content): Merge conflict in src/foo.js`
  - returns `[]` when no conflicts in output

---

## Task G3 — Implement dependency-aware task scheduling

**File to modify:** `src/orchestrator/index.js`

The current `assignTasks()` method (line 191) uses simple round-robin and ignores the `depends_on` field on tasks. This means a task can be started before its dependencies finish.

### What to implement

Replace the body of `executeTasks()` (line 214) with dependency-aware parallel execution:

1. Build a dependency graph from `task.depends_on` (array of task IDs).
2. Use a **wave-based** approach:
   - Wave 0: tasks with no dependencies → execute all in parallel
   - Wave 1: tasks whose `depends_on` are all in `done` state → execute in parallel
   - Repeat until all tasks are done or failed
3. A task whose dependency failed should itself be marked `failed` with summary `"Skipped: dependency <id> failed"` — do **not** execute it.
4. Poll every `this.pollIntervalMs` between waves (reuse the existing pattern).

**Constraints:**
- Keep `assignTasks()` as-is (round-robin pre-assignment is fine).
- Only change `executeTasks()` and add any private helpers needed.
- Do not change the public API of `Orchestrator`.
- Add JSDoc to any new private methods.

**Helper to add:**

```js
/**
 * Return tasks that are ready to execute (all depends_on are done).
 * @param {import('../types/index.js').Task[]} tasks
 * @returns {import('../types/index.js').Task[]}
 */
_getReadyTasks(tasks) { ... }
```

---

## Task G4 — Implement `--tasks` CLI flag in orchestrator

**File to modify:** `src/orchestrator/index.js`

The CLI entry point (bottom of file, around line 339) shows `--tasks tasks.json` in the help text but never handles it. Implement it.

### Behaviour

When invoked as:
```
node src/orchestrator/index.js --tasks path/to/tasks.json
```

1. Read the JSON file at the given path.
2. Expect the file to be either:
   - An array of task objects: `[{id, title, description, depends_on?}, ...]`
   - Or an object with a `tasks` property containing such an array
3. Load these tasks into the `TaskManager` using `taskManager.addTasks(parsed)`.
4. Run the orchestration pipeline from **Step 2** onward (skip `decomposeTasks` — tasks are already defined).
5. If the file doesn't exist or is invalid JSON, print a clear error and `process.exit(1)`.

**Add a new method to `Orchestrator`:**

```js
/**
 * Load tasks from a JSON file instead of decomposing from a prompt.
 * @param {string} filePath - Absolute or relative path to tasks JSON file
 * @returns {Promise<import('../types/index.js').Task[]>}
 */
async loadTasksFromFile(filePath) { ... }
```

Update the CLI section at the bottom to handle `--tasks <file>` before the existing `--help`/`--check-agents` checks.

---

## Task G5 — Integration test scaffolding

**Directory to create:** `tests/integration/`

Create the following files:

### `tests/integration/helpers.js`

```js
// Shared helpers for integration tests
export function skipIfNoCli(name) { ... }  // checks if CLI is in PATH, skips test if not
export async function runCli(command, args, cwd) { ... }  // thin wrapper around execFileAsync
export function makeTmpDir() { ... }  // creates unique temp dir, returns path + async cleanup fn
```

### `tests/integration/adapter.integration.test.js`

Tests that actually invoke the CLI if available. Each test must:
- Call `skipIfNoCli('claude')` or `skipIfNoCli('gemini')` at the top
- Use a real temp directory as `workDir`
- Assert the result has `status`, `summary`, `filesChanged`, `duration_ms`
- Not assert specific content (output is non-deterministic)

Tests:
- ClaudeCodeAdapter: `isAvailable()` returns true when claude is in PATH
- ClaudeCodeAdapter: `execute()` with a trivial prompt returns a TaskResult
- GeminiAdapter: `isAvailable()` returns true when gemini is in PATH
- GeminiAdapter: `execute()` with a trivial prompt returns a TaskResult

### `tests/integration/taskmanager.integration.test.js`

- Creates real `TaskManager` in a temp dir
- Full lifecycle: `addTask` → `claimTask` → `updateStatus('in_progress')` → `updateStatus('done')`
- Verifies `isAllComplete()` returns true after all tasks done
- Verifies `getSummary()` counts are accurate

---

## General rules for all tasks

- **ES modules only** (`import`/`export`) — no `require()`
- **No new dependencies** — use only `node:test`, `node:assert`, `node:fs`, `node:os`, `node:path`, `node:child_process`
- **Run `npm test` before marking a task done** — all existing 80 tests must still pass
- **Follow existing code style**: 2-space indent, single quotes, JSDoc on public methods
- **Do not modify `src/taskmanager/`** or any existing test files
