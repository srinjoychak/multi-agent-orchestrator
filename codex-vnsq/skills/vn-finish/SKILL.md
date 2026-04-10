---
name: vn-finish
description: Complete a development branch by verifying tests, merging back to base, or creating a PR. Use when work on a branch is finished.
---

# `vn-finish` — Finish a Development Branch

Verify tests, present completion options, execute the chosen path, and clean up worktrees.

## Step 1: Verify Tests

Run the project's test suite.

If tests fail: display failures and stop.

## Step 2: Determine Base Branch

```bash
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master
```

## Step 3: Present Options

1. Merge back locally
2. Push and create a Pull Request
3. Keep the branch as-is
4. Discard this work

## Step 4: Execute Choice

Use the standard merge, PR, keep, or discard flow. Cleanup worktrees for options 1, 2, and 4.
