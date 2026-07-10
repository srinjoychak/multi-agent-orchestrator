# Agy-VN-Squad — Test Validation Plan

This document outlines the steps to verify the Antigravity-native VN-Squad v2 orchestration.

---

## 1. Unit Verification: Worker Scripts

Verify each adapter script can invoke its target CLI and return structured JSON.

| Command | Expected Outcome |
|---|---|
| `node agy-vnsq/scripts/agy-ask.js "what is 2+2"` | JSON output with `summary: "4"`, `exitCode: 0`. |
| `node agy-vnsq/scripts/claude-ask.js "what is 2+2"` | JSON output with `summary: "4"`, `exitCode: 0`. |
| `node agy-vnsq/scripts/codex-ask.js "what is 2+2"` | JSON output with `summary: "4"`, `exitCode: 0`. |

### 1a. Regression checks: agy silent-failure modes

`agy` reports `exitCode: 0` and plausible-looking output even when these fail — a passing exit
code alone does NOT confirm correctness. Verify explicitly:

| Check | Command | Expected |
|---|---|---|
| Model actually switches | `node agy-vnsq/scripts/agy-ask.js "What model are you? Reply with just the model name." --model pro` vs `--model flash` | The two `summary` values differ (`Gemini 3.1 Pro` vs `Gemini 3.5 Flash`) — if identical, `--model` is silently no-op-ing again. |
| File lands in the real project dir | `node agy-vnsq/scripts/agy-ask.js "Create hello.js with console.log('hi')" --work-dir <scratch-dir>` then `ls <scratch-dir>/hello.js` | File exists at `<scratch-dir>/hello.js` — if missing, `agy` fell back to sandboxing writes into its own scratch dir again. |
| Pre-existing file can be read and modified, not just created | Write a small file, ask agy to edit one value in it via `--work-dir`, then `cat` it back | Change applied correctly in place. |
| Cleanup on interrupt | Start a long-running prompt in the background, `kill -TERM` it mid-run, then check `find /tmp -maxdepth 1 -iname "agy-auth-*"` | No leftover `agy-auth-*` directories (which would contain the OAuth token). |

---

## 2. Integration: Skill Deployment

Verify skills are correctly discovered by the Antigravity CLI.

1. **Deploy**: `bash agy-vnsq/scripts/deploy-agy-squad.sh`
2. **Confirm file placement**: check `~/.gemini/skills/` (global) or `<target>/.gemini/skills/` (workspace) contains a `vn-*` directory per skill, each copied from `agy-vnsq/skills/`.
3. **Confirm actual discovery (do not skip — file presence alone does not prove discovery)**:
   `agy -p "Do you have a skill called vn-agy? Answer yes or no." --dangerously-skip-permissions`
   must answer yes. `~/.agents/skills/` looks correct per Antigravity's own bundled docs but was
   confirmed NOT to be scanned in live testing — only `~/.gemini/skills/` is confirmed working.
4. **List**: run `agy` interactively, execute `/help`, and confirm all `vn-*` skills are present — no reload step is needed since Antigravity re-scans on session start.

---

## 3. End-to-End: Orchestration Workflow

Perform a controlled "mini-task" to verify the Tech Lead loop.

### Phase A: Planning
**Command:** `/vn-plan add a hello world script to the root directory`
**Verification:**
- Antigravity produces a structured plan with TDD steps.
- Plan is saved/displayed correctly.

### Phase B: Design Debate
**Command:** `/vn-argue should the hello world script be .js or .sh?`
**Verification:**
- Antigravity writes a proposal to `DESIGN.md`.
- `codex-ask.js` is triggered to review it.
- Consensus is reached in 1-2 rounds.
- `DESIGN.md` exists with the final decision.

### Phase C: Dispatch (Parallel Execution)
**Command:**
```
/vn-dispatch
  [agy] create hello.js with console.log('hello')
  [claude] create hello.sh with echo 'hello'
```
**Verification:**
- Both files are created independently.
- Background processes complete successfully.
- Summary of work is presented.

### Phase D: Verification & Cleanup
**Command:** `/vn-verify`
**Verification:** Confirms `hello.js` and `hello.sh` exist and work.

**Command:** `/vn-finish`
**Verification:** Merges changes (if on branch) and cleans up.

---

## 4. Error Handling

1. **Invalid Command**: Verify `/vn-dispatch` handles a failing agent gracefully (e.g., `[agy] run a non-existent-command`).
2. **Conflicting Tasks**: Dispatch two agents to modify the same file and verify git conflict behavior.

---

## 5. Uninstallation Verification

Verify all components are correctly removed.

1. **Uninstall**: `bash agy-vnsq/scripts/uninstall-agy-squad.sh`
2. **Confirm**: `~/.gemini/skills/` (or `<target>/.gemini/skills/` for a workspace uninstall) no longer contains any `vn-*` directories.
3. **Clean Scripts**: Verify `~/.gemini/scripts/` does not contain `*-ask.js` files.
