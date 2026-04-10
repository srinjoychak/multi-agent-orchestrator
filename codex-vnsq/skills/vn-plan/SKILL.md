---
name: vn-plan
description: Create comprehensive implementation plans with TDD steps, code samples, and exact commands. Use when a non-trivial task needs to be decomposed before starting.
---

# `vn-plan` — Writing Implementation Plans

Create comprehensive implementation plans assuming the engineer has minimal codebase context.
Document everything needed: which files to modify per task, complete code samples, testing
procedures, and exact commands with expected outputs.

## Requirements

- Map files for creation or modification before defining tasks
- Keep each task independently testable
- Prefer exact file paths over vague references
- Include failing test, minimal implementation, verification command, and commit step

## Execution Handoff

After saving the plan, present two options:
1. Subagent-driven via `vn-dispatch`
2. Inline execution with checkpoints
