# Adding a New Adapter

This guide walks through extending the orchestrator with a new AI CLI agent. The example uses a hypothetical `codex` CLI, but the pattern applies to any headless CLI tool.

---

## The AgentAdapter Interface

All adapters extend the `AgentAdapter` base class defined in `src/adapters/base.js`. The base class handles:

- CLI availability checking (`isAvailable()`)
- Process spawning and timeout enforcement (`execute()`)
- Process termination (`abort()`)

You provide only the agent-specific logic: how to build the command-line arguments and how to interpret the output.

### Constructor signature

```js
constructor(name, command, options = {})
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique agent identifier used in task assignments and logs (e.g., `"codex"`) |
| `command` | `string` | The executable name as it appears in `PATH` (e.g., `"codex"`) |
| `options.timeoutMs` | `number` | Milliseconds before the process is killed. Default: `300000` (5 min) |

### Required methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `buildArgs` | `(task, context) → string[]` | Returns the CLI argument array passed to `execFile` |
| `parseOutput` | `(stdout, stderr, duration_ms) → TaskResult` | Parses raw CLI output into a structured result |

### Optional methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `getVersionFlag` | `() → string` | Flag used by `isAvailable()` to probe the CLI. Default: `'--version'` |
| `getEnvOverrides` | `(context) → Object` | Environment variables merged into the subprocess env |

---

## Step-by-Step: Create the Codex Adapter

### Step 1: Create the adapter file

Create `src/adapters/codex.js`:

```js
import { AgentAdapter } from './base.js';

/**
 * Adapter for OpenAI Codex CLI.
 *
 * Invokes: codex -p "<prompt>" --json
 * Works in the assigned git worktree directory.
 */
export class CodexAdapter extends AgentAdapter {
  constructor(options = {}) {
    super('codex', 'codex', options);
  }

  /**
   * The flag used to probe whether the CLI is installed.
   * Override if --version is not supported by your CLI.
   */
  getVersionFlag() {
    return '--version';
  }

  /**
   * Build the CLI argument array.
   *
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string[]}
   */
  buildArgs(task, context) {
    const prompt = this._buildPrompt(task, context);
    // Codex CLI example: codex -p "<prompt>" --json
    return ['-p', prompt, '--json'];
  }

  /**
   * Compose a structured prompt from task + context.
   *
   * @param {import('../types/index.js').Task} task
   * @param {import('../types/index.js').TaskContext} context
   * @returns {string}
   */
  _buildPrompt(task, context) {
    return [
      `Task: ${task.title}`,
      '',
      task.description,
      '',
      `Working directory: ${context.workDir}`,
      `Branch: ${context.branch}`,
      '',
      'Instructions:',
      '- Complete the task described above.',
      '- Only modify files relevant to this task.',
      '- Do not modify files outside the scope of this task.',
      '- When done, provide a summary of changes made.',
    ].join('\n');
  }

  /**
   * Parse raw CLI output into a TaskResult.
   *
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} duration_ms
   * @returns {import('../types/index.js').TaskResult}
   */
  parseOutput(stdout, stderr, duration_ms) {
    try {
      const parsed = JSON.parse(stdout);
      return {
        status: 'done',
        summary: parsed.result || parsed.text || stdout.slice(0, 500),
        filesChanged: parsed.files_changed || [],
        output: stdout,
        duration_ms,
      };
    } catch {
      // Fallback: treat plain text output as the summary
      return {
        status: 'done',
        summary: stdout.slice(0, 500),
        filesChanged: [],
        output: stdout,
        duration_ms,
      };
    }
  }

  /**
   * Optional: inject environment variables into the subprocess.
   * Useful for API keys or model selection flags.
   *
   * @param {import('../types/index.js').TaskContext} context
   * @returns {Object}
   */
  getEnvOverrides(context) {
    return {
      // CODEX_MODEL: 'o4-mini',
    };
  }
}
```

### Step 2: Register in the orchestrator

Open `src/orchestrator/index.js` and add your adapter to the `candidates` array in `initialize()`:

```js
// Before:
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { GeminiAdapter } from '../adapters/gemini.js';

// After:
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { CodexAdapter } from '../adapters/codex.js';  // add this
```

Then inside `initialize()`:

```js
const candidates = [
  new ClaudeCodeAdapter({ timeoutMs: this.taskTimeoutMs }),
  new GeminiAdapter({ timeoutMs: this.taskTimeoutMs }),
  new CodexAdapter({ timeoutMs: this.taskTimeoutMs }),  // add this
];
```

That is all. The orchestrator's auto-detection loop calls `isAvailable()` on every candidate and only activates adapters whose CLI is found in `PATH`.

### Step 3: Test your adapter

**Availability check:**

```bash
npm run check-agents
# Should now show: [+] codex — available
```

**Single-adapter smoke test:**

Remove `claude` and `gemini` from `PATH` temporarily (or test in an environment where only `codex` is installed), then run:

```bash
node src/orchestrator/index.js "Create a file named test.txt"
```

Verify that:
- The orchestrator detects `codex` as the only available agent
- The task is assigned to `codex`
- A result appears in `.agent-team/results/T1.json`
- The worktree branch is created and merged

**Full integration test (all agents):**

Restore all CLIs to `PATH` and run a multi-task prompt:

```bash
node src/orchestrator/index.js "Write a hello world script in Python and document it"
```

Confirm that tasks are distributed across agents and both produce valid results.

---

## TaskResult contract

Your `parseOutput()` must always return a valid `TaskResult` — never throw. The base class catches exceptions during `execFile`, but `parseOutput` is called only on successful process exit. Return a graceful fallback on unexpected output:

```js
// Minimum valid TaskResult
{
  status: 'done',       // 'done' | 'failed'
  summary: '...',       // human-readable string, shown in the report
  filesChanged: [],     // string[] of relative file paths (can be empty)
  output: stdout,       // raw output — always pass through for debugging
  duration_ms: 1234,    // already computed for you, pass as-is
}
```

If the CLI output indicates a failure, return `status: 'failed'` rather than throwing:

```js
if (parsed.error) {
  return {
    status: 'failed',
    summary: parsed.error.message,
    filesChanged: [],
    output: stdout,
    duration_ms,
  };
}
```

---

## Notes on CLI requirements

The orchestrator expects the CLI to be:

1. **Non-interactive** — it must accept the full prompt via a flag (e.g., `-p`) and exit when done. CLIs that require keyboard interaction cannot be used.
2. **Headless-compatible** — it must work without a TTY (the orchestrator spawns processes with `execFile`, not in a terminal emulator).
3. **Deterministic exit** — it must exit with code `0` on success and non-zero on error.

GitHub Copilot CLI is explicitly excluded from v1 because it does not currently support headless/non-interactive mode.
