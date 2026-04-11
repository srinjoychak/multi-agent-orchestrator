---
name: vn-claude
description: Delegate a research, implementation, or review prompt to Claude CLI via the claude-ask.js adapter.
---

# `vn-claude` — Claude CLI Adapter

Delegate a focused prompt to Claude CLI via `codex-vnsq/scripts/claude-ask.js`.

## Invocation

```text
vn-claude [--model sonnet|opus] <prompt>
```

## Workflow

Announce: `Delegating to Claude ($MODEL): $PROMPT`

Run:

```bash
node codex-vnsq/scripts/claude-ask.js "$PROMPT" --model "$MODEL"
```

Parse the JSON output and present `summary` to the user.

## When to Use Claude

- adversarial review
- second-opinion implementation planning
- focused refactors
- test-writing passes
- long-form reasoning that benefits from a second model
