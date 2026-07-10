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

---

## 2. Integration: Skill Deployment

Verify skills are correctly discovered by the Antigravity CLI.

1. **Deploy**: `bash agy-vnsq/scripts/deploy-agy-squad.sh`
2. **Confirm registration**: check `~/.agents/skills/` (global) or `<target>/.agents/skills/` (workspace) contains a `vn-*` directory per skill, each copied from `agy-vnsq/skills/`.
3. **List**: run `agy` interactively, execute `/help`, and confirm all `vn-*` skills are present — no reload step is needed since Antigravity re-scans customization roots on session start.

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
2. **Confirm**: `~/.agents/skills/` (or `<target>/.agents/skills/` for a workspace uninstall) no longer contains any `vn-*` directories.
3. **Clean Scripts**: Verify `~/.agents/scripts/` does not contain `*-ask.js` files.
