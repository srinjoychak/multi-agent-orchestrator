# Gemini Tech Lead — Session Brief
_Written by: Claude Sonnet 4.6 (outgoing Tech Lead) — 2026-03-23_

---

## Your Role

You are the **Tech Lead** for this session. You must:
- Use the orchestrator CLI to decompose, assign, execute, and review all work
- Maintain **80% Gemini agents / 20% Claude agents** throughout
- Gemini agents do the primary work (investigation, testing, fixing, docs)
- Claude agents verify output, review code, and validate documentation
- Commit, push, and open a PR when all objectives are met

You operate EXCLUSIVELY through the orchestrator CLI — never tell the user to run commands manually.

---

## Orchestrator Commands

```bash
node src/orchestrator/index.js decompose "<request>"
node src/orchestrator/index.js assign
node src/orchestrator/index.js execute [taskId]
node src/orchestrator/index.js status
node src/orchestrator/index.js accept <taskId>
node src/orchestrator/index.js reject <taskId> "reason"
node src/orchestrator/index.js reset --hard
```

Working directory: `D:\ALL_AUTOMATION\copilot_adapter`

Agent capabilities (from `agents.json`):
- `gemini`: quota 70 — research, docs, analysis, code, test
- `claude-code`: quota 30 — code, refactor, test, debug

---

## Context: What Has Been Done So Far

I (Claude Sonnet 4.6) have been the Tech Lead on the `gemini-agent-fix` branch.
The goal was to make Gemini CLI agents reliably write files when dispatched by the orchestrator.

### Three root causes I identified and fixed

**Root Cause B — `_getChangedFiles` misses untracked files**
- File: `src/adapters/gemini.js` → `_getChangedFiles()`
- Old code: `git diff --name-only HEAD` — only shows modified tracked files
- Problem: Gemini writes new files in a fresh worktree (no prior commits), so they are untracked and `git diff HEAD` returns nothing → `filesChanged: []` even when Gemini succeeded
- Fix applied: replaced with `git status --porcelain`

**Root Cause C — `parseOutput` fragility with pretty-printed JSON**
- File: `src/adapters/gemini.js` → `parseOutput()`
- Old code: `JSON.parse(lastLine)` — took last line of stdout and parsed it
- Problem: Gemini CLI `--output-format json` emits pretty-printed JSON. Last line is `}` alone, which fails `JSON.parse`
- Fix applied: replaced with `_tryParseJson()` — 3 strategies: full string, NDJSON line scan, outermost `{...}` block extraction

**Root Cause A/D — False-positive `done` status on monologue output**
- File: `src/adapters/gemini.js` → `parseOutput()` catch block
- Old code: catch always returned `{ status: 'done' }` — even for plain text / monologue
- Problem: When Gemini described its plan instead of writing files, the task was accepted as successful with `filesChanged: []`
- Fix applied: no-JSON output now returns `{ status: 'failed' }` → task retries

**Root Cause (bonus) — CLAUDE.md overwritten by orchestrator**
- File: `src/adapters/base.js` → `execute()`
- Problem: `buildContextFile()` writes `CLAUDE.md` to `context.workDir`. During the decompose step, `workDir === projectRoot`, so the real project-level `CLAUDE.md` got overwritten with the task context
- Fix applied: skip context file write when `context.workDir === context.projectRoot`

**Additional fix — Task type normalization**
- File: `src/orchestrator/core.js` → `decomposeTasks()`
- Problem: Decomposer sometimes returns tasks with `type` not in the valid set, causing `[?]` display
- Fix applied: normalize to `code` if type is not in `{code,refactor,test,debug,research,docs,analysis}`

All fixes committed. Tests: **204 pass, 0 fail, 2 skip** on branch `gemini-agent-fix`.

---

## The Remaining Problem — What I Could NOT Fix

### Symptom
When the orchestrator dispatches a Gemini agent with a simple docs task:
```
"Write docs/gemini-verified.md with a markdown table comparing Jest, Vitest, and Node test runner"
```
The Gemini CLI process **hangs for the full 15-minute timeout and produces no output** (empty stdout).

The task then retries, falls to Claude as fallback, and Claude completes it successfully. This means the orchestrator retry/fallback logic works, but Gemini itself never executes.

### Evidence
- `.worktrees/gemini-T1/GEMINI.md` exists → context file was written correctly ✓
- `.worktrees/gemini-T1/` has no `docs/` directory → Gemini wrote no files ✗
- `tasks.json`: `retries: 1`, `previous_agents: ["gemini"]` → Gemini timed out, Claude took over
- Exit: timeout after 900_000ms (15 min)

### What I suspect but could not confirm
1. **`--approval-mode=yolo` flag may no longer be valid** in current Gemini CLI version — if it errors silently, the process could hang waiting for interactive input
2. **`--output-format json` behaviour** may have changed — newer Gemini CLI versions may not support this flag the same way
3. **The `-p` prompt delivery** may be triggering Gemini's interactive safety prompt instead of running non-interactively
4. **Gemini CLI version mismatch** — the adapter was written against an older API surface; flags may have changed

### What I have NOT done
- Tested Gemini CLI manually with the exact command the adapter builds
- Checked `gemini --help` or `gemini --version` to validate flag compatibility
- Verified that `--output-format json` produces the shape the adapter expects
- Checked if there is a `--non-interactive` or `--yes` flag needed
- Tested with `--model gemini-2.0-flash` (a known-fast model) to see if the default model is the issue

### Code path that builds the Gemini CLI command
```javascript
// src/adapters/gemini.js → _buildArgs()
const args = ['-p', prompt, '--output-format', 'json', '--approval-mode=yolo'];
const model = this.getModel(task.type);
if (model) args.push('--model', model);
// agents.json has "models": {} so no --model is added currently
```

---

## My Execution Plan (Please Evaluate and Suggest Improvements)

Here is my proposed plan for resolving the Gemini hang issue. I ask you, as the incoming Tech Lead, to evaluate this plan, identify flaws, and run it (with improvements) through the orchestrator:

### Phase 1 — Diagnose the Gemini CLI hang (Gemini agents, 1–2 tasks)
1. Run `gemini --version` and `gemini --help` to capture actual flags and output format
2. Run the exact command the adapter builds with a simple prompt and capture stdout/stderr
3. Run with `--model gemini-2.0-flash` (fast model) to test if default model selection is the issue
4. Try removing `--approval-mode=yolo` to see if it's causing a silent error

### Phase 2 — Fix the adapter (1 Claude agent task for code change, 1 Gemini for test)
1. Update `_buildArgs()` in `gemini.js` based on Phase 1 findings (correct flags, correct model, correct output format)
2. Add stderr logging so hangs are visible in the orchestrator output
3. Reduce timeout for Gemini to 120s (2 min) with fast retry — don't wait 15 min for a hang

### Phase 3 — Verify end-to-end (1 Gemini agent task)
1. Run `reset --hard` then decompose the gemini-verified.md task
2. Confirm `filesChanged` includes `gemini-verified.md`
3. Confirm the file has real content (not empty)

### Phase 4 — Documentation (1 Gemini agent task)
1. Write `docs/gemini-agent-fix-report.md` documenting what was wrong and what was fixed
2. Include CLI flags reference for future maintainers

### Phase 5 — Claude verification (1 Claude agent task, the 20%)
1. Review all code changes for correctness
2. Run `npm test` and confirm 0 failures
3. Verify `docs/gemini-verified.md` and `docs/gemini-agent-fix-report.md` exist and have meaningful content

### Phase 6 — Commit, push, PR (you as Tech Lead)
1. `git add` all changed files
2. Commit with message following the project convention
3. Push `gemini-agent-fix` to origin
4. Open PR against `master`

---

## My Challenges and Lessons Learned

These are real pain points I hit — please take them into account:

1. **The CLAUDE.md overwrite trap**: The orchestrator writes `CLAUDE.md` to `context.workDir`. During the PLAN/decompose task, `workDir` is the project root. This silently corrupts the real project instructions that Claude Code (as Tech Lead) depends on. I fixed this but it took two sessions to notice.

2. **Decompose fallback creates `type: null` tasks**: When `_extractJsonArray` can't parse the planner's output, it creates a single fallback task with `type: null`. The display shows `[?]`. I fixed type normalization for the JSON-parse path but NOT for the fallback path. You may want to add a default type in the fallback too.

3. **The 15-minute timeout masks the real error**: `taskTimeoutMs: 900_000` means a Gemini hang takes 15 minutes to surface. You can't iterate fast. I recommend reducing Gemini's timeout to 120s in `agents.json` or passing `timeoutMs` per-adapter.

4. **`git diff HEAD` vs `git status --porcelain`**: This was subtle — in a fresh worktree with no commits, `git diff HEAD` fails silently (no HEAD to diff against) and returns empty. `git status --porcelain` works correctly. This was the most impactful fix for cases where Gemini DID write files.

5. **The `--approval-mode=yolo` flag**: I never validated this flag exists in the current Gemini CLI version. If it doesn't, the process likely enters an error state or hangs waiting for approval. This is my primary hypothesis for the current hang.

6. **Decompose prompt quality**: When CLAUDE.md is corrupted, the Claude planner produces prose instead of JSON, and `_extractJsonArray` fails. The fallback creates a usable single task but loses structured metadata. Consider adding a JSON schema validator or a retry if the planner output isn't valid JSON.

---

## Key Files Reference

| File | Purpose |
|---|---|
| `src/adapters/gemini.js` | Gemini adapter — `_buildArgs()`, `parseOutput()`, `_getChangedFiles()` |
| `src/adapters/base.js` | Base lifecycle — `execute()`, `buildContextFile()` |
| `src/orchestrator/core.js` | Orchestrator — `decomposeTasks()`, `_runTask()`, `taskTimeoutMs` |
| `agents.json` | Agent capabilities, quota, model overrides |
| `PLAN.md` | Full project plan and current state |
| `CLAUDE.md` | Claude Code project instructions (do NOT overwrite this) |

---

## Success Criteria for This Session

- [ ] Root cause of Gemini CLI hang identified with evidence
- [ ] `_buildArgs()` updated with correct flags
- [ ] E2E test passes: Gemini writes `docs/gemini-verified.md` with `filesChanged` populated
- [ ] `npm test` — 204+ pass, 0 fail
- [ ] `docs/gemini-agent-fix-report.md` written by a Gemini agent
- [ ] All changes reviewed by a Claude agent
- [ ] PR opened against `master` on branch `gemini-agent-fix`
- [ ] 80/20 Gemini/Claude agent split maintained throughout

---

## One Final Ask

Before executing the plan, please:
1. Read `PLAN.md` for full project context
2. Run `node src/orchestrator/index.js status` to see current task state
3. Evaluate my execution plan above — is Phase 1 the right starting point, or is there a faster path?
4. Proceed with your improved plan

Good luck. — Claude Sonnet 4.6 (Tech Lead, outgoing)
