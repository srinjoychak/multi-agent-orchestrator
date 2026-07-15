---
name: vn-dispatch
description: Dispatch independent tasks to specialized agents (Antigravity, Claude, Codex) working in parallel using worker scripts. Use when parallelizing implementation, tests, or research.
---

# /vn-dispatch — Parallel Agent Dispatch

*Adapted from VN-Squad v2 (Claude-native) for Antigravity CLI*

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
| `[agy]` | `agy-ask.js` | `--model flash|pro` |
| `[codex]` | `codex-ask.js` | e.g. `--model gpt-5.4-mini` |
| `[claude]` | `claude-ask.js` | e.g. `--model sonnet` |

**Finding these scripts:** check, in order, `agy-vnsq/scripts/` relative to the git repo root
(working directly in this repo), `.gemini/scripts/` relative to the git repo root (workspace
deploy), or `~/.gemini/scripts/` (global deploy). See `/vn-agy` for details.

**Each annotated task should run in its own isolated git worktree** (use `/vn-worktrees` first).

---

## How to dispatch as Antigravity Tech Lead

1. **List all tasks** with annotations.
2. **For EACH task**, spawn a background shell process using `run_shell_command` with `is_background: true`.
3. **Task Execution Protocol**:
   Redirect outputs to `/tmp/vnsq-<task-id>.*` to track progress and results:
   ```bash
   node <scripts-dir>/[agent]-ask.js "<prompt>" \
     --work-dir <worktree> \
     > /tmp/vnsq-<id>.stdout.json \
     2> /tmp/vnsq-<id>.stderr.log; \
     echo $? > /tmp/vnsq-<id>.exit
   ```
4. **Completion Monitoring**:
   Poll for the existence of the `.exit` file for each task.
5. **Review and integrate**:
   - Read `.stdout.json` for the agent's summary (token usage is only reported by `claude-ask.js`/`codex-ask.js`; `agy-ask.js` does not report it).
   - Read `.stderr.log` if the exit code in `.exit` is non-zero.
   - Verify no file conflicts before merging worktrees.

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
  - Do NOT modify: AGENTS.md, DESIGN.md, agents.json
  - After all files are done: git add -A && git commit -m "task: [name]"

Done when:
  - [ ] [verifiable checklist item]
  - [ ] git log shows new commit
```
