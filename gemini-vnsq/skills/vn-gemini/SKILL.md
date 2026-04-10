---
name: vn-gemini
description: Delegate a research, analysis, or large-context prompt to Gemini CLI via the gemini-ask.js adapter.
---

# /gemini — Gemini CLI Adapter

*Sourced from VN-Squad v2 (Claude setup)*

Delegate a research, analysis, or planning prompt to Gemini CLI via the lightweight
`gemini-vnsq/scripts/gemini-ask.js` adapter. No Docker required.

## Invocation

```
/gemini [--model flash|pro|pro-exp] <prompt>
```

## Model Selection

| Model | Best for |
|---|---|
| `flash` (default) | Summaries, quick research, docs |
| `pro` | Security analysis, complex reasoning |
| `pro-exp` | Architecture review, large context |

## Workflow

**Announce:** "Delegating to Gemini (`$MODEL`): $PROMPT"

Run:
```bash
node gemini-vnsq/scripts/gemini-ask.js "$PROMPT" --model "$MODEL"
```

Parse the JSON output and present `summary` to the user.

## When to Use Gemini

- **Research**: Compare libraries, explain concepts, survey documentation
- **Large context**: Analyze many files at once
- **Docs**: Write comprehensive documentation
- **Planning**: Explore design alternatives before `/argue`
