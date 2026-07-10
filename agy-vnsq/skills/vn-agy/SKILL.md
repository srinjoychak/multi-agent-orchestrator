---
name: vn-agy
description: Delegate a research, analysis, or large-context prompt to Antigravity CLI via the agy-ask.js adapter.
---

# /vn-agy — Antigravity CLI Adapter

*Sourced from VN-Squad v2 (Claude setup)*

Delegate a research, analysis, or planning prompt to Antigravity CLI via the lightweight
`agy-vnsq/scripts/agy-ask.js` adapter. No Docker required.

## Invocation

```
/vn-agy [--model flash|pro] <prompt>
```

## Model Selection

| Model | Best for |
|---|---|
| `flash` (default) | Summaries, quick research, docs |
| `pro` | Security analysis, complex reasoning, architecture review, large context |

## Workflow

**Announce:** "Delegating to Antigravity (`$MODEL`): $PROMPT"

Run:
```bash
node agy-vnsq/scripts/agy-ask.js "$PROMPT" --model "$MODEL"
```

Parse the JSON output and present `summary` to the user.

## When to Use Antigravity

- **Research**: Compare libraries, explain concepts, survey documentation
- **Large context**: Analyze many files at once
- **Docs**: Write comprehensive documentation
- **Planning**: Explore design alternatives before `/vn-argue`
