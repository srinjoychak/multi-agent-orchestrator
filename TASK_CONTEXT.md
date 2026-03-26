# Task Context — T3

**Task:** Add static validate method to Agent Router
**Type:** code

## Objective
Add a static validate(agents) method to src/router/index.js. The method must check that each agent object has a 'name' (string), 'capabilities' (non-empty array), and 'quota' (number between 0 and 100). Throw an error if any agent is invalid.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T3
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.

## Git Instructions
- This directory is a git worktree. Use shell commands (run_shell_command) for all git operations.
- Do NOT attempt to read the .git file directly — it is a worktree pointer.
- To commit: run_shell_command("git add -A && git commit -m \"task: T3\"") 
- Git identity is pre-configured — no need to set user.name or user.email.