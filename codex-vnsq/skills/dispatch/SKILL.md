---
name: dispatch
description: Dispatch independent tasks to parallel agents with explicit routing annotations for Codex-led sessions.
---

# Dispatch

Use this skill when work can be split into independent tasks.

## Annotation syntax

| Annotation | Route |
|---|---|
| `[codex]` | `node scripts/codex-ask.js` |
| `[claude]` | `node scripts/claude-ask.js` |
| `[gemini]` | `node scripts/gemini-ask.js` |

## Rules

- Require explicit annotations for every task.
- Only dispatch tasks that do not depend on each other.
- Put each task in its own worktree if the task touches code.
- Wait for all tasks to finish, then reconcile changes and verify the result.
- Each routed task should include a self-contained prompt with file paths and expected output.

## Output

- List the tasks and their routes.
- State which files each task owns.
- State any conflicts that need manual merge handling.
