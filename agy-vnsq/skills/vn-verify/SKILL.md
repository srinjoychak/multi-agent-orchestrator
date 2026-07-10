---
name: vn-verify
description: Run verification commands to confirm a task is complete. Use as a gate before claiming completion.
---

# /verify — Verification Gate

*Sourced from VN-Squad v2 (Claude setup)*

Gate the completion of any task on actual evidence. Run the verification commands
defined in the plan or task description.

## Workflow

1. Identify verification commands for the current task:
   - Linting: `npm run lint`, `ruff check .`
   - Tests: `npm test`, `pytest`, `cargo test`
   - Types: `tsc`, `mypy .`
   - Build: `npm run build`, `make`

2. Execute commands sequentially.

3. If any command fails:
   - Report the failure
   - Fix the underlying issue
   - Re-run verification

4. If all commands pass:
   - Report success with evidence (e.g., "All 42 tests passed")
   - Proceed to `/review` or `/finish`

## Prohibited

Never claim a task is complete without running at least one verification command.
If no specific command is given, run the project's default test suite.
