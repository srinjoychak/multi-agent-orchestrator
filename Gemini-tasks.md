# Gemini Agent Task — V1 End-to-End Verification

**Branch:** `archive/v1-autonomous-cli`
**Goal:** Run the orchestrator against a real, controlled example. Document exactly what works, what fails, and what errors surface. Produce `VERIFICATION_REPORT.md`.

This is a **testing and documentation task** — do NOT modify any source code. If something fails, document it, do not fix it.

---

## Task V1 — Run the orchestrator end-to-end and write VERIFICATION_REPORT.md

### Step 1 — Confirm baseline

```bash
npm test
```

Expected: 141 tests, 140 pass, 1 skip. If different, note it in the report.

### Step 2 — Check agent availability

```bash
node src/orchestrator/index.js --check-agents
```

Document which agents are available and their versions.

### Step 3 — Create a controlled test task file

Create `test-run/tasks.json` with this exact content — small, predictable scope:

```json
[
  {
    "id": "T1",
    "title": "Create a simple utility module",
    "description": "Create a file at test-run/output/utils.js that exports two functions: add(a, b) which returns a + b, and multiply(a, b) which returns a * b. Use ES module syntax (export). Add a JSDoc comment to each function.",
    "type": "code",
    "depends_on": []
  },
  {
    "id": "T2",
    "title": "Write tests for the utility module",
    "description": "Create a file at test-run/output/utils.test.js that tests both add() and multiply() from utils.js using Node.js built-in node:test and node:assert. Import utils.js using ES module import. Test at least 3 cases per function.",
    "type": "test",
    "depends_on": ["T1"]
  },
  {
    "id": "T3",
    "title": "Document the utility module",
    "description": "Create a file at test-run/output/UTILS_README.md documenting the utils.js module. Include: purpose, function signatures, usage examples, and any edge cases.",
    "type": "docs",
    "depends_on": ["T1"]
  }
]
```

### Step 4 — Run the orchestrator

```bash
node src/orchestrator/index.js --tasks test-run/tasks.json
```

Capture the full stdout output. Note any errors.

### Step 5 — Inspect outputs

After the run (or after any failure), check:
- `ls .agent-team/` — did the directory structure get created?
- `cat .agent-team/tasks.json` — what are the final task statuses?
- `ls .agent-team/results/` — were result files written?
- `cat .agent-team/report.json` — was the report generated?
- `ls .worktrees/` — were worktrees created?
- `git branch` — were agent branches created?
- `ls test-run/output/` — did the agents actually produce files?

### Step 6 — Write VERIFICATION_REPORT.md

Create `VERIFICATION_REPORT.md` in the project root with this structure:

```markdown
# V1 Verification Report

**Date:** YYYY-MM-DD
**Tester:** Gemini CLI
**Branch:** archive/v1-autonomous-cli

## Environment
- Node.js version:
- claude CLI version:
- gemini CLI version:
- OS:

## Test Run Summary
[PASS / PARTIAL / FAIL]

## Step-by-Step Results

### npm test
[output summary]

### --check-agents
[output]

### Orchestrator run with test-run/tasks.json
[full stdout output]
[any errors / stack traces]

## What Worked
- [list each thing that worked correctly]

## What Failed
- [list each failure with the exact error]

## File Outputs
- .agent-team/ created: YES/NO
- tasks.json final state: [paste content]
- result files written: YES/NO / [list files]
- report.json generated: YES/NO
- worktrees created: YES/NO
- agent branches created: YES/NO
- test-run/output/ files produced: YES/NO / [list files]

## Conclusion
[1 paragraph summary: is v1 ready as a base for Phase 3? what needs attention?]
```

### Step 7 — Clean up

After the report is written, clean up the test run artifacts:

```bash
# Remove worktrees
git worktree list
# For each test worktree: git worktree remove <path> --force

# Delete agent branches created during the test
git branch | grep agent/
# git branch -D <each branch>

# Remove runtime dirs
rm -rf .agent-team .worktrees test-run/output
```

### Step 8 — Commit and push

Commit only these two files to `archive/v1-autonomous-cli`:
- `VERIFICATION_REPORT.md`
- `test-run/tasks.json` (keep as a reference example)

```bash
git add VERIFICATION_REPORT.md test-run/tasks.json
git commit -m "docs: add v1 verification report and test task fixture

— Gemini CLI (Dev Agent)"
git push
```

Do NOT raise a PR — push directly to `archive/v1-autonomous-cli`.

---

## Rules

- **Do not modify any source files** — this is observation only
- Document failures honestly — do not hide errors
- If the orchestrator crashes early, document exactly where and why
- Sign your commit: `— Gemini CLI (Dev Agent)`
