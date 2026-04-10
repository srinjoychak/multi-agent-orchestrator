---
name: vn-scaffold
description: Generate a tiered difficulty ladder for a complex or failing task. Decomposes into increasingly complex, independently testable subtasks.
---

# `vn-scaffold` — Curriculum Task Decomposition

Generate a tiered difficulty ladder for a task that has failed or is too complex to
dispatch directly.

## Workflow

1. Decompose the task into 3-4 tiers of increasing complexity.
2. Keep each tier independently testable and committable.
3. Gate each tier on success before dispatching the next.
4. After all tiers succeed, report a summary of what was completed.
