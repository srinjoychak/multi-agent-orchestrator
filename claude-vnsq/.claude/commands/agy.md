# /agy — Antigravity CLI Adapter

Delegate a research, analysis, or planning prompt to Antigravity CLI via the lightweight
`scripts/agy-ask.js` adapter. No Docker required.

## Invocation

```
/agy [--model flash|pro] <prompt>
```

**Examples:**
```
/agy what are the tradeoffs of Drizzle ORM vs Prisma for SQLite?

/agy --model pro analyze the security implications of the auth middleware

/agy --model flash summarize the last 50 git commits

/agy --model pro review the entire src/ directory for architectural issues
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
node scripts/agy-ask.js "$PROMPT" --model "$MODEL"
```

Parse the JSON output:
```json
{
  "summary": "...",
  "model": "flash",
  "exitCode": 0
}
```

Present `summary` to the user. Unlike the old `/gemini` skill, `agy` reports no token-usage
figures — there is nothing further to surface.

If `exitCode != 0`:
- Report the error
- Suggest: `agy --version` to verify CLI is installed
- Suggest: run `agy` interactively once to complete OAuth login (no API-key auth is available)

## When to Use Antigravity

- **Research**: Compare libraries, explain concepts, survey documentation
- **Large context**: Analyze many files at once
- **Docs**: Write comprehensive documentation, READMEs, API docs
- **Planning**: Explore design alternatives before `/argue`
- **Quota conservation**: Tasks where Claude quota is scarce

## Prerequisites

```bash
# Install Antigravity CLI — see https://antigravity.google/docs/cli-overview
agy                                # run once to complete OAuth login
node scripts/agy-ask.js "test"     # verify adapter works
```
