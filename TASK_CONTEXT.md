# Task Context — T3

**Task:** Add static validate method to AgentRouter
**Type:** code

## Objective
In src/router/index.js, add a static validate(agents) method. For each agent in the array, ensure it has a 'name', 'capabilities' (a non-empty array), and 'quota' (an integer between 0 and 100 inclusive). Throw a descriptive Error if any agent is invalid.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T3
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.

## Git Instructions
- This directory is a git worktree. Use shell commands (run_shell_command) for all git operations.
- Do NOT attempt to read the .git file directly — it is a worktree pointer.
- To commit: run_shell_command("git add -A && git commit -m \"task: T3\"") 
- Git identity is pre-configured — no need to set user.name or user.email.