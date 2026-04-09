---
name: dispatch
description: Dispatch independent tasks to parallel agents with explicit routing annotations for Codex-led sessions.
---

# Dispatch

Use this skill when work can be split into independent tasks.

## Annotation syntax

- `[codex]` route to Codex-backed execution
- `[external]` route to another backend only when the session explicitly provides one

## Rules

- Require explicit annotations for every task.
- Only dispatch tasks that do not depend on each other.
- Put each task in its own worktree if the task touches code.
- Wait for all tasks to finish, then reconcile changes and verify the result.

## Output

- List the tasks and their routes.
- State which files each task owns.
- State any conflicts that need manual merge handling.
