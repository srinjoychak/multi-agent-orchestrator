---
name: vn-dispatch
description: Dispatch independent tasks to specialized agents (Gemini, Claude, Codex) working in parallel using worker scripts. Use when parallelizing implementation, tests, or research.
---

# /dispatch — Parallel Agent Dispatch

*Sourced from VN-Squad v2 (Claude setup)*

Dispatch independent tasks to specialized agents working in parallel, each in their own
isolated context and git worktree.

**Any agent can handle any task type.** Routing is by your explicit annotation.

---

## Annotation syntax

```
[agent] task description
[agent --model <model>] task description
```

| Annotation | Routes to | Model flag |
|---|---|---|
| `[gemini]` | `gemini-vnsq/scripts/gemini-ask.js` | `--model flash|pro|pro-exp` |
| `[codex]` | `gemini-vnsq/scripts/codex-ask.js` | e.g. `--model gpt-5.4-mini` |
| `[claude]` | `gemini-vnsq/scripts/claude-ask.js` | e.g. `--model sonnet` |

**Each annotated task should ideally run in its own isolated git worktree** (use `/worktrees` first).

---

## How to dispatch as Gemini Tech Lead

1. **List all tasks** with annotations.
2. **For EACH task**, spawn a background shell process using `run_shell_command` with `is_background: true`:
   - If `[gemini]`: `node gemini-vnsq/scripts/gemini-ask.js "<prompt>" --model <model> --work-dir <worktree>`
   - If `[claude]`: `node gemini-vnsq/scripts/claude-ask.js "<prompt>" --model <model> --work-dir <worktree>`
   - If `[codex]`: `node gemini-vnsq/scripts/codex-ask.js "<prompt>" --model <model> --work-dir <worktree>`
3. **Wait for all to complete** by monitoring the background processes or checking the output files.
4. **Review and integrate**:
   - Read each agent's summary from the console output.
   - Verify no file conflicts.
   - Run the full test suite.

---

## Task prompt template

Each agent receives an isolated context. Embed everything it needs:

```
Task: [Name]
Working directory: [absolute path]

Files to create/modify:
  - [absolute path/file.js] (create — purpose)

Full requirements:
  [complete requirements, no external references]

Instructions:
  - Non-interactive shell only
  - Do NOT modify: GEMINI.md, DESIGN.md, agents.json
  - After all files are done: git add -A && git commit -m "task: [name]"

Done when:
  - [ ] [verifiable checklist item]
  - [ ] git log shows new commit
```
