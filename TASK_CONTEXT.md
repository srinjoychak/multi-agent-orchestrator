# Task Context — T1

**Task:** Implement TokenTracker class in src/tracker/index.js
**Type:** code

## Objective
Read src/taskmanager/index.js and src/taskmanager/schema.sql. Then implement the TokenTracker class in src/tracker/index.js with these async methods: constructor(taskManager); parseClaude(stdout) [parse JSON to {input, output, cache_read, cost_usd} | null]; parseGemini(stdout, prompt) [estimate {input_est, output_est, cost_usd:0} as chars/4 for both input and output]; record(taskId, usage) [SQL: UPDATE tasks SET token_usage=? WHERE id=?]; summaryByAgent() [query tasks table, aggregate by assigned_to]; totalCost() [query tasks table for {totalCost, taskCount}].

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T1
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.

## Git Instructions
- This directory is a git worktree. Use shell commands (run_shell_command) for all git operations.
- Do NOT attempt to read the .git file directly — it is a worktree pointer.
- To commit: run_shell_command("git add -A && git commit -m \"task: T1\"") 
- Git identity is pre-configured — no need to set user.name or user.email.