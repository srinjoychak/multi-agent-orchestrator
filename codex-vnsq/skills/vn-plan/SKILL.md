---
name: vn-plan
description: Create comprehensive implementation plans with TDD steps, code samples, and exact commands. Use when a non-trivial task needs to be decomposed before starting.
---

# `vn-plan` — Writing Implementation Plans

Create comprehensive implementation plans assuming the engineer has minimal codebase context.
Document everything needed: which files to modify per task, complete code samples, testing
procedures, and exact commands with expected outputs. Deliver plans as bite-sized tasks
following DRY, YAGNI, and TDD principles with frequent commits.

**Announce:** "I'm using vn-plan to create the implementation plan."

## Scope Check

If specifications span multiple independent subsystems, recommend breaking into separate plans —
one per subsystem. Each plan must produce independently testable, working software.

## File Structure Mapping

Before defining tasks, map files for creation or modification:
- Each file should have one clear responsibility
- Files changing together should be colocated by responsibility
- Follow established codebase patterns

## Bite-Sized Task Granularity

Each step = one action (2–5 minutes):
- Write failing test → Verify test fails → Implement minimal code → Verify test passes → Commit

## Plan Document Header (Required)

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** Use vn-dispatch to implement task-by-task.

**Goal:** [One sentence]
**Architecture:** [2–3 sentences]
**Tech Stack:** [Key technologies]
```

## Task Structure

```markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.js`
- Modify: `exact/path/to/existing.js`

- [ ] **Step 1: Write the failing test**
      [complete code block]

- [ ] **Step 2: Run test to verify it fails**
      Run: [exact command]
      Expected: [specific output]

- [ ] **Step 3: Write minimal implementation**
      [complete code block]

- [ ] **Step 4: Verify test passes**
      Run: [exact command]  Expected: PASS

- [ ] **Step 5: Commit**
      git add -A && git commit -m "task: [N] [description]"
```

## Prohibited Content (Plan Failures)

Never include: "TBD", "TODO", "implement later", vague guidance like "add error handling",
"write tests for the above" without actual test code, "similar to Task N" references.

## Self-Review Checklist

1. **Spec Coverage** — map each requirement to a task
2. **Placeholder Scan** — no TBDs or vague steps
3. **Type Consistency** — signatures match across tasks

## Execution Handoff

After saving the plan, present two options:
1. Subagent-driven via `vn-dispatch`
2. Inline execution with checkpoints
