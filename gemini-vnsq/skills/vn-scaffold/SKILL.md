---
name: vn-scaffold
description: Generate a tiered difficulty ladder for a complex or failing task. Decomposes into increasingly complex, independently testable sub-tasks.
---

# /scaffold — Curriculum Task Decomposition

*Sourced from VN-Squad v2 (Claude setup)*

Generate a tiered difficulty ladder for a task that has failed or is too complex to
dispatch directly. Uses Gemini to decompose into increasingly complex sub-tasks.

## When to use
- A task has failed multiple times
- A task description is too broad
- You want to break a complex feature into independently testable tiers

## Workflow

1. Send to Gemini (`gemini-ask.js`): "Decompose this task into 3-4 tiers of increasing complexity.
   Each tier must be independently testable and committable.
   Task: <description>"

2. Present tiers to Tech Lead (Gemini) for approval:
   ```
   Tier 1: <simplest subtask — interfaces/types only>
   Tier 2: <core implementation>
   Tier 3: <full feature with edge cases>
   Tier 4 (optional): <integration/hardening>
   ```

3. On approval: `/dispatch` each tier as a separate task.
   Gate each tier on success before dispatching the next.

4. After all tiers succeed: report a summary of what was completed.
