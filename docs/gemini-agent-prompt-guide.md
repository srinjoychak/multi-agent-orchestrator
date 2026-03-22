# Gemini Agent Prompt Guide

This guide explains the correct way to construct prompts and context files for Gemini agents within the `copilot-adapter` orchestrator.

## The "Subagent Delegation" Trap

### Root Cause
Gemini CLI interprets tool calls (like `write_file`, `read_file`, or `run_shell_command`) as internal subagent delegation. When a prompt or the `GEMINI.md` context file contains language like:
- "Do NOT delegate to subagents"
- "Do NOT use sub-agents"
- "Do NOT call other agents"

Gemini interprets this as a global restriction on **all tool access**. Instead of executing the requested tasks, it enters an infinite investigation loop (calling `cli_help`, `grep_search`, etc.) while claiming that it does not have the tools required to write files. This leads to task timeouts (900s).

### Redundant Injection
This issue is compounded when the same restriction appears in both the native `GEMINI.md` file (which the CLI reads automatically) and the `-p` prompt string. Redundant constraints trigger stricter behavior in Gemini's model, increasing the likelihood of tool-call suppression.

## Best Practices

### 1. Scope Constraints vs. Behavior Constraints
Focus on **what** the agent should touch, not **how** it should internalize its tool use.

- **SAFE (Scope):** "Only modify files in the `src/adapters` directory."
- **UNSAFE (Behavior):** "Do not delegate this task to any subagent."

### 2. Single Source of Truth
Gemini CLI natively reads `GEMINI.md` from the current working directory. The orchestrator now uses this as the primary source of context. We **never** inject the `GEMINI.md` content into the `-p` prompt, as doing so creates redundant and potentially conflicting instructions.

### 3. Safe Prompt Language
Use imperative, task-focused language.

#### SAFE Examples:
- "Create a new unit test for the Gemini adapter."
- "Refactor the base adapter to remove redundant context enrichment."
- "Only touch `src/orchestrator/core.js`."

#### UNSAFE Examples:
- "Complete this task yourself without delegating." (Breaks tool use)
- "Do not use tools to call other agents." (Often misread as 'do not use tools')

## Example Configuration

### Good `GEMINI.md`
```markdown
# Task Context — T1
**Agent:** gemini
**Task:** Create unit test
**Branch:** agent/gemini/T1

## Objective
Create src/adapters/gemini.test.js with coverage for buildArgs.

## Constraints
- Work only within: D:\project\.worktrees\gemini-T1
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.
```

### Good `-p` Prompt
```bash
Task: Create unit test

Create src/adapters/gemini.test.js with coverage for buildArgs.

Working directory: D:\project\.worktrees\gemini-T1
Branch: agent/gemini/T1

Constraints:
- Only modify files within your assigned working directory.
- When done, provide a brief summary of what you changed.
```
