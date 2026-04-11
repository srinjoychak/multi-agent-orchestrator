---
name: vn-dispatch
description: Dispatch independent tasks to specialized agents working in parallel using Codex, Claude, and Gemini worker scripts.
---

# `vn-dispatch` — Parallel Agent Dispatch

Dispatch independent tasks to specialized agents working in parallel, each in their own
isolated context and git worktree.

Any agent can handle any task type. Routing is by explicit annotation.

## Annotation syntax

```text
[agent] task description
[agent --model <model>] task description
```

| Annotation | Routes to | Model flag |
|---|---|---|
| `[codex]` | `codex-vnsq/scripts/codex-ask.js` | e.g. `--model gpt-5.4-mini` |
| `[claude]` | `codex-vnsq/scripts/claude-ask.js` | e.g. `--model sonnet` |
| `[gemini]` | `codex-vnsq/scripts/gemini-ask.js` | `--model flash|pro|pro-exp` |

Each annotated task should run in its own isolated git worktree. Use `vn-worktrees` first or let
the dispatcher create the worktrees for you.

## Execution protocol

Run the dispatcher script with the annotated task block:

```bash
node codex-vnsq/scripts/vn-dispatch.js --worktree-root .worktrees <<'EOF'
[codex] create hello.js with console.log('hello')
[claude] create hello.sh with echo 'hello'
[gemini --model flash] summarize the README in one paragraph
EOF
```

The dispatcher will:
- parse the annotations
- create one worktree per task
- launch the matching worker adapter
- write `/tmp/vnsq-<id>.stdout.json`, `/tmp/vnsq-<id>.stderr.log`, and `/tmp/vnsq-<id>.exit`
- return a JSON summary with per-task exit codes

If you want to clean up worktrees after inspection, use:

```bash
git worktree remove --force <worktree-path>
git branch -D <branch-name>
git worktree prune
```
