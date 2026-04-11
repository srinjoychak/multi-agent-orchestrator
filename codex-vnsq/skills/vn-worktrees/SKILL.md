---
name: vn-worktrees
description: Manage isolated git worktrees for parallel development. Use when dispatching tasks or starting parallel features.
---

# `vn-worktrees` — Git Worktree Management

Create and manage isolated git worktrees for parallel development with smart directory
selection and safety verification.

## Workflow

1. Detect the repo root
2. Choose a worktree directory
3. Verify the path is ignored or acceptable
4. Create a new branch and worktree
5. Run the project's baseline setup or tests
6. Report the full path and baseline status

Use `vn-finish` to handle the full cleanup and merge or PR flow automatically.
