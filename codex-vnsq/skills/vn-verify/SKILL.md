---
name: vn-verify
description: Run verification commands to confirm a task is complete. Use as a gate before claiming completion.
---

# `vn-verify` — Verification Gate

Gate the completion of any task on actual evidence. Run the verification commands defined in
the plan or task description.

## Workflow

1. Identify verification commands for the current task
2. Execute commands sequentially
3. If any command fails, report it, fix it, and re-run verification
4. If all commands pass, report success with evidence

Never claim a task is complete without running at least one verification command.
