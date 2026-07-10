---
name: vn-agy
description: Delegate a research, analysis, or large-context prompt to Antigravity CLI via the agy-ask.js adapter.
---

# `vn-agy` — Antigravity CLI Adapter

Delegate a research, analysis, or planning prompt to Antigravity CLI via
`codex-vnsq/scripts/agy-ask.js`.

## Invocation

```text
vn-agy [--model flash|pro] <prompt>
```

## Workflow

Announce: `Delegating to Antigravity ($MODEL): $PROMPT`

Run:

```bash
node codex-vnsq/scripts/agy-ask.js "$PROMPT" --model "$MODEL"
```

Parse the JSON output and present `summary` to the user.
