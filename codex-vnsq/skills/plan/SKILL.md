---
name: plan
description: Decompose a non-trivial task into bite-sized TDD steps with exact file paths, commands, and verifiable outcomes for Codex-led sessions.
---

# Plan

Use this skill before implementation starts.

## Output shape

- State the goal in one sentence.
- Break the work into small tasks.
- For each task include:
  - files to create or modify
  - the failing check or test first
  - the minimal implementation step
  - the verification command
  - the commit step

## Rules

- Prefer exact file paths over vague references.
- Include concrete commands, not just advice.
- Keep tasks independently testable.
- If the task spans multiple subsystems, split it into separate plans.

