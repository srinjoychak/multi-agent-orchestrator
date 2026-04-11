---
name: vn-gemini
description: Delegate a research, analysis, or large-context prompt to Gemini CLI via the gemini-ask.js adapter.
---

# `vn-gemini` — Gemini CLI Adapter

Delegate a research, analysis, or planning prompt to Gemini CLI via
`codex-vnsq/scripts/gemini-ask.js`.

## Invocation

```text
vn-gemini [--model flash|pro|pro-exp] <prompt>
```

## Workflow

Announce: `Delegating to Gemini ($MODEL): $PROMPT`

Run:

```bash
node codex-vnsq/scripts/gemini-ask.js "$PROMPT" --model "$MODEL"
```

Parse the JSON output and present `summary` to the user.
