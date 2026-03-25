# Task Context — T1

**Task:** Create ARCHITECTURE.md for v3 architecture
**Type:** docs

## Objective
Create a file named ARCHITECTURE.md in the project root. Document the v3 architecture including: 
1. System Overview.
2. Key Components: MCP server, orchestrator core, task manager, docker runner, worktree manager, agent router.
3. End-to-end task flow from orchestrate() call to task_accept() completion.
4. Agent Roster: gemini and claude-code.
Constraints: The document must be professional, clear, and under 120 lines total.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T1
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.
- When done, commit your changes with: git add -A && git commit -m "task: T1"