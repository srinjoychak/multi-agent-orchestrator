# Task Context — T1

**Task:** Create CHANGELOG.md for v3 refactor
**Type:** docs

## Objective
Create CHANGELOG.md in the project root documenting the v3 refactor. Include sections for major changes: MCP server, Docker workers, SQLite task manager, worktree isolation, and agent router.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T1
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.

## Git Instructions
- This directory is a git worktree. Use shell commands (run_shell_command) for all git operations.
- Do NOT attempt to read the .git file directly — it is a worktree pointer.
- To commit: run_shell_command("git add -A && git commit -m \"task: T1\"") 
- Git identity is pre-configured — no need to set user.name or user.email.