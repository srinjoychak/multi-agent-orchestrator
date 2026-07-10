---
name: vn-agy
description: Delegate a research, analysis, or large-context prompt to Antigravity CLI via the agy-ask.js adapter.
---

# /vn-agy — Antigravity CLI Adapter

*Sourced from VN-Squad v2 (Claude setup)*

Delegate a research, analysis, or planning prompt to Antigravity CLI via the lightweight
`agy-ask.js` adapter. No Docker required.

## Finding the adapter script

The install layout varies by deployment scope — check in this order and use whichever exists:
1. `agy-vnsq/scripts/agy-ask.js` relative to the git repo root (working directly in this repo)
2. `.agents/scripts/agy-ask.js` relative to the git repo root (workspace-scoped deploy)
3. `~/.agents/scripts/agy-ask.js` (global deploy)

Use `git rev-parse --show-toplevel` to find the repo root for options 1 and 2.

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

Run (substituting whichever adapter path was found above):
```bash
node <agy-ask.js path> "$PROMPT" --model "$MODEL"
```

Parse the JSON output and present `summary` to the user.

## When to Use Antigravity

- **Research**: Compare libraries, explain concepts, survey documentation
- **Large context**: Analyze many files at once
- **Docs**: Write comprehensive documentation
- **Planning**: Explore design alternatives before `/vn-argue`
