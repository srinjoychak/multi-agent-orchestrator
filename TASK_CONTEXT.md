# Task Context — T2

**Task:** Create CONTRIBUTING.md guidelines
**Type:** docs

## Objective
Create CONTRIBUTING.md in the project root with contribution guidelines. Include sections for environment setup, branching strategy (using agent/* branches), running tests (via npm test), and the PR process.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/gemini-T2
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.

## Git Instructions
- This directory is a git worktree. Use shell commands (run_shell_command) for all git operations.
- Do NOT attempt to read the .git file directly — it is a worktree pointer.
- To commit: run_shell_command("git add -A && git commit -m \"task: T2\"") 
- Git identity is pre-configured — no need to set user.name or user.email.