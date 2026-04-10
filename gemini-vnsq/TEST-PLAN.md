# Gemini-VN-Squad — Test Validation Plan

This document outlines the steps to verify the Gemini-native VN-Squad v2 orchestration.

---

## 1. Unit Verification: Worker Scripts

Verify each adapter script can invoke its target CLI and return structured JSON.

| Command | Expected Outcome |
|---|---|
| `node gemini-vnsq/scripts/gemini-ask.js "what is 2+2"` | JSON output with `summary: "4"`, `exitCode: 0`. |
| `node gemini-vnsq/scripts/claude-ask.js "what is 2+2"` | JSON output with `summary: "4"`, `exitCode: 0`. |
| `node gemini-vnsq/scripts/codex-ask.js "what is 2+2"` | JSON output with `summary: "4"`, `exitCode: 0`. |

---

## 2. Integration: Skill Deployment

Verify skills are correctly packaged and recognized by the Gemini CLI.

1. **Deploy**: `bash gemini-vnsq/scripts/deploy-gemini-squad.sh`
2. **Reload**: Execute `/skills reload` in Gemini interactive session.
3. **List**: Execute `/skills list` and confirm all `vn-*` skills are present.

---

## 3. End-to-End: Orchestration Workflow

Perform a controlled "mini-task" to verify the Tech Lead loop.

### Phase A: Planning
**Command:** `/vn-plan add a hello world script to the root directory`
**Verification:**
- Gemini produces a structured plan with TDD steps.
- Plan is saved/displayed correctly.

### Phase B: Design Debate
**Command:** `/vn-argue should the hello world script be .js or .sh?`
**Verification:**
- Gemini writes a proposal to `DESIGN.md`.
- `codex-ask.js` is triggered to review it.
- Consensus is reached in 1-2 rounds.
- `DESIGN.md` exists with the final decision.

### Phase C: Dispatch (Parallel Execution)
**Command:**
```
/vn-dispatch
  [gemini] create hello.js with console.log('hello')
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

1. **Invalid Command**: Verify `/vn-dispatch` handles a failing agent gracefully (e.g., `[gemini] run a non-existent-command`).
2. **Conflicting Tasks**: Dispatch two agents to modify the same file and verify git conflict behavior.

---

## 5. Uninstallation Verification

Verify all components are correctly removed.

1. **Uninstall**: `bash gemini-vnsq/scripts/uninstall-gemini-squad.sh`
2. **Reload**: Execute `/skills reload` in Gemini interactive session.
3. **List**: Execute `/skills list` and confirm no `vn-*` skills are present.
4. **Clean Scripts**: Verify `~/.gemini/scripts/` does not contain `*-ask.js` files.
