---
name: scaffold
description: Break an oversized or repeatedly failing task into tiered, independently testable subtasks.
---

# Scaffold

Use this skill when a task is too broad or has failed repeatedly.

## Workflow

1. Decompose the task into 3 to 4 tiers.
2. Keep each tier independently testable.
3. Gate each tier on success before moving to the next.
4. Re-dispatch the tiers as separate tasks.

## Constraints

- No tier may depend on a later tier.
- No placeholders or vague substeps.
- Each tier should have a concrete verification step.

