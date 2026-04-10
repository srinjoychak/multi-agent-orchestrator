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

Each annotated task should run in its own isolated git worktree. Use `vn-worktrees` first.

## Execution protocol

For each task, run a background shell process and redirect artifacts to:

```bash
node codex-vnsq/scripts/[agent]-ask.js "<prompt>" \
  --work-dir <worktree> \
  > /tmp/vnsq-<id>.stdout.json \
  2> /tmp/vnsq-<id>.stderr.log
echo $? > /tmp/vnsq-<id>.exit
```

Poll for the `.exit` file for each task. Then:
- read `.stdout.json`
- read `.stderr.log` on non-zero exit
- verify there are no merge conflicts before integrating worktrees
