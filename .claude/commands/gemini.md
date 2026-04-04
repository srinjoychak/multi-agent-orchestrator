# /gemini — Gemini CLI Adapter

Delegate a research, analysis, or planning prompt to Gemini CLI via the lightweight
`scripts/gemini-ask.js` adapter. No Docker required.

## Invocation

`/gemini <prompt>` — e.g. `/gemini explain the tradeoffs of ESM vs CJS in Node.js 22`

Flags:
- `--model flash` (default) or `--model pro`
- `--work-dir <path>` (defaults to current directory)

## Workflow

**Announce:** "Delegating to Gemini: $PROMPT"

Run:
```bash
node scripts/gemini-ask.js "$PROMPT" [--model $MODEL] [--work-dir $WORK_DIR]
```

Parse the JSON output:
```json
{
  "summary": "...",
  "model": "gemini-2.0-flash",
  "exitCode": 0,
  "tokenUsage": { "input": ..., "output": ..., "total": ... }
}
```

Present `summary` to the user. If `exitCode != 0`, report the error and suggest
running `gemini --version` to verify the CLI is installed.

## When to use Gemini

- **Research**: Large-context analysis, reading many files at once
- **Docs**: Writing comprehensive documentation
- **Planning**: Exploring design alternatives before /argue
- **Free-tier tasks**: Tasks where Claude quota is scarce

## Prerequisites

- `gemini` CLI installed: `npm install -g @google/gemini-cli`
- Gemini authenticated: `gemini auth` (or `~/.gemini/oauth_creds.json` exists)
- `scripts/gemini-ask.js` present in the repo root
