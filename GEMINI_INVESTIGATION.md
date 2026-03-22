# Gemini Agent Investigation

## Root Cause Analysis

The investigation revealed three primary issues causing Gemini agents to mark tasks as "done" with `filesChanged: []` while only producing a plan/monologue.

### 1. Robustness of `parseOutput` (Root Cause C)
The `GeminiAdapter.parseOutput` implementation is fragile. It tries to parse the last line of `stdout` as JSON:
```javascript
const lines = trimmed.split('\n').filter(Boolean);
const lastLine = lines[lines.length - 1];
const parsed = JSON.parse(lastLine);
```
Since Gemini CLI often outputs pretty-printed JSON, the last line is frequently just `}`, which causes `JSON.parse` to throw. 

### 2. False Positive Fallback (Root Cause A/D)
When `JSON.parse` fails (due to the issue above or because Gemini monologued without outputting JSON), the `catch` block incorrectly returns `status: 'done'`:
```javascript
} catch {
  // Fallback: treat as plain text
  return {
    status: 'done',
    summary: trimmed.slice(0, 500),
    filesChanged: [],
    output: stdout,
    duration_ms,
  };
}
```
This is why the orchestrator thinks the task is complete even when it's just a monologue. The `summary` becomes the first 500 characters of the junk/monologue output.

### 3. File Change Detection (Root Cause B)
The `_getChangedFiles` method uses `git diff --name-only HEAD`. This command ONLY shows changes to **tracked** files. New files created by Gemini are **untracked** and thus do not appear in the results, leading to `filesChanged: []`.

### 4. Agent Monologuing
Gemini CLI 0.34.0 sometimes enters an investigative loop, reading project files like `CLAUDE.md` and adapter code, instead of executing the `write_file` tool. This is likely due to the agent getting confused by the repository's own structure or missing explicit "force" in the prompt to use tools immediately.

---

## Exact Fixes Needed

### Fix 1: Robust JSON Extraction & Error Handling
In `src/adapters/gemini.js`, `parseOutput` should be updated to find the JSON block and return `failed` if no JSON is found.

**File:** `src/adapters/gemini.js` (around line 105)

### Fix 2: Detect Untracked Files
In `src/adapters/gemini.js` (and `src/adapters/claude-code.js`), `_getChangedFiles` should use `git status --porcelain` to catch new files.

**File:** `src/adapters/gemini.js` (around line 175)
**File:** `src/adapters/claude-code.js` (around line 160)

### Fix 3: False-Positive Guard
Add a guard to `GeminiAdapter.execute` to fail tasks that were supposed to write files but didn't.

**File:** `src/adapters/gemini.js` (around line 95)

---

## Evidence

- **T1.json** summary was a monologue starting with "MCP issues detected...", which is the beginning of Gemini's stdout.
- **Manual Test** confirmed that `git diff --name-only HEAD` does not see new files.
- **Manual Test** confirmed that Gemini CLI outputs pretty-printed JSON by default, breaking the `lastLine` parsing logic.
- **Worktree Status** for `gemini-T1` showed `docs/gemini-verified.md` did not exist, but `GEMINI.md` was present and untracked.
