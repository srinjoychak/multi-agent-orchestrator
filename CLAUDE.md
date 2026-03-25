# Task Context — T1

**Task:** Create ARCHITECTURE.md
**Type:** docs

## Objective
Create a file named ARCHITECTURE.md in the project root documenting the v3 architecture. Include: 1. System overview. 2. Key components: MCP server, orchestrator core, task manager, docker runner, worktree manager, and agent router. 3. End-to-end task flow: from orchestrate() to task_accept(). 4. Agent roster: gemini + claude-code. The document must be under 120 lines.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T1
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.
- When done, commit your changes with: git add -A && git commit -m "task: T1"