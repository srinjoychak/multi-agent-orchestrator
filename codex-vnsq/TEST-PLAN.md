# Codex-VN-Squad — Test Validation Plan

This document outlines the steps to verify the Codex-native VN-Squad v2 orchestration.

---

## 1. Unit Verification: Worker Scripts

Verify each adapter script can invoke its target CLI and return structured JSON.

| Command | Expected Outcome |
|---|---|
| `node codex-vnsq/scripts/codex-ask.js "what is 2+2"` | JSON output with `summary: "4"` or equivalent, `exitCode: 0`. |
| `node codex-vnsq/scripts/claude-ask.js "what is 2+2"` | JSON output with `summary: "4"` or equivalent, `exitCode: 0`. |
| `node codex-vnsq/scripts/gemini-ask.js "what is 2+2"` | JSON output with `summary: "4"` or equivalent, `exitCode: 0`. |

---

## 2. Integration: Skill Deployment

Verify skills are correctly installed and recognized by Codex.

1. **Deploy**: `bash codex-vnsq/scripts/deploy-codex-vnsq.sh`
2. **Inspect**: Confirm `~/.codex/skills/` contains:
   - `vn-plan`
   - `vn-dispatch`
   - `vn-scaffold`
   - `vn-argue`
   - `vn-gemini`
   - `vn-claude`
   - `vn-worktrees`
   - `vn-finish`
   - `vn-verify`
   - `vn-review`
3. **Inspect**: Confirm `~/.codex/AGENTS.md` contains the Codex Tech Lead instructions.

---

## 3. End-to-End: Orchestration Workflow

Perform a controlled mini-task to verify the Tech Lead loop.

### Phase A: Planning

**Prompt:** use `vn-plan` for `add a hello world script to the root directory`

**Verification:**
- Codex produces a structured plan with TDD steps.
- The plan includes exact file paths and commands.

### Phase B: Design Debate

**Prompt:** use `vn-argue` for `should the hello world script be .js or .sh?`

**Verification:**
- Codex writes a proposal to `DESIGN.md`.
- `claude-ask.js` is triggered to review it.
- Consensus is reached in 1-2 rounds.
- `DESIGN.md` exists with the final decision.

### Phase C: Dispatch

**Prompt:**

```text
vn-dispatch
  [codex] create hello.js with console.log('hello')
  [claude] create hello.sh with echo 'hello'
  [gemini --model flash] summarize the task in one sentence
```

**Verification:**
- Both files are created independently.
- Background processes complete successfully.
- A summary of work is available in the `.stdout.json` artifacts.
- The dispatcher JSON reports all three tasks with `exitCode: 0`.
- The dispatcher created one worktree per task.
- After inspection, manually remove the temp worktrees with:
  - `git worktree remove --force /tmp/codex-vnsq-dispatch-test/<branch-name>`
  - `git branch -D <branch-name>`
  - `git worktree prune`

### Phase D: Verification & Cleanup

**Prompt:** use `vn-verify`

**Verification:** Confirms `hello.js` and `hello.sh` exist and run.

**Prompt:** use `vn-finish`

**Verification:** Merges changes or creates a PR and cleans up worktrees.

---

## 4. Error Handling

1. **Invalid command**: verify `vn-dispatch` handles a failing agent gracefully.
2. **Conflicting tasks**: dispatch two agents to modify the same file and verify conflict handling.
3. **Missing CLI**: temporarily remove `claude` or `gemini` from `PATH` and confirm adapters fail with a clear error.
4. **Dispatcher routing**: verify `vn-dispatch` routes `[claude]` and `[gemini]` annotations to the matching worker adapters.

---

## 5. Uninstallation Verification

Verify all components are correctly removed.

1. **Uninstall**: `bash codex-vnsq/scripts/uninstall-codex-vnsq.sh`
2. **Inspect**: confirm `~/.codex/skills/vn-*` entries are gone.
3. **Inspect**: confirm `~/.codex/scripts/` does not contain `*-ask.js` files from Codex-VN-Squad.
