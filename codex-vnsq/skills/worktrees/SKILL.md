---
name: worktrees
description: Create and manage isolated git worktrees with baseline checks and safe branch handling.
---

# Worktrees

Use this skill when parallel work or isolation is needed.

## Workflow

1. Detect the repo root.
2. Choose a worktree directory.
3. Verify the path is ignored or acceptable.
4. Create a new branch and worktree.
5. Run the project's baseline setup or tests.
6. Report the full path and baseline status.

## Safety

- Never create a worktree without checking its location first.
- Do not skip baseline verification.
- Clean up the worktree when the task is done.

