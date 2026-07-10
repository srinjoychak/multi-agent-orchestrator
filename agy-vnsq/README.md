# Agy-VN-Squad

**Skills-native multi-agent orchestration for Antigravity CLI. No Docker. No servers. Just skills.**

Antigravity CLI, Claude Code, and Codex collaborate within your session through a curated set of
slash command skills — debating designs, dispatching parallel work, and reviewing each other's
output.

> Ported from Gemini-VN-Squad after Google decommissioned Gemini CLI in favor of
> [Antigravity CLI](https://antigravity.google) (`agy`), June 2026.

---

## Architecture

Agy-VN-Squad replicates the VN-Squad v2 orchestration model directly within the Antigravity CLI
using native skills.

| Capability | Implementation |
|---|---|
| Tech Lead | Antigravity CLI (via `agy-vnsq/AGENTS.md`) |
| Task execution | `agy` CLI subagents (subprocess mode) |
| Design review | `/vn-argue` — Antigravity↔Codex debate loop |
| Claude work | `scripts/claude-ask.js` (direct CLI) |
| Codex work | `scripts/codex-ask.js` (direct CLI) |
| Isolation | Git worktrees via `/vn-worktrees` |

---

## Skills

All skills are plain `SKILL.md` directories, auto-discovered by Antigravity CLI's native
customization system (no packaging/zip step — that was a Gemini CLI requirement that Antigravity
dropped) and invoked as slash commands.

| Skill | What it does |
|---|---|
| `/vn-plan <task>` | Decompose into TDD bite-sized steps with exact file paths and code samples |
| `/vn-dispatch <tasks>` | Dispatch independent tasks to parallel agents (Antigravity, Claude, Codex) |
| `/vn-scaffold <task>` | Decompose a complex task into tiered subtasks |
| `/vn-argue <topic>` | Antigravity proposes design → Codex challenges → consensus loop |
| `/vn-agy <prompt>` | Direct Antigravity CLI call (recursive or large-context) |
| `/vn-worktrees` | Create isolated git worktrees for parallel work |
| `/vn-finish` | Test-verified branch completion (merge or PR) |
| `/vn-verify` | Gate: run actual verification before claiming completion |
| `/vn-review` | Dispatch a code-reviewer subagent |

---

## Agents

Three specialized worker scripts handle delegation:

| Agent | Script | CLI Required |
|---|---|---|
| `[agy]` | `scripts/agy-ask.js` | `agy` |
| `[claude]` | `scripts/claude-ask.js` | `claude` |
| `[codex]` | `scripts/codex-ask.js` | `codex` |

---

## Model Selection

`agy models` only lists full display names (e.g. `Gemini 3.1 Pro (High)`) — there is no model
literally named `flash` or `pro`. **`agy` does not validate `--model`**: passing a short alias or
any unrecognized string silently falls back to its own default with `exitCode: 0`, no error —
confirmed by hands-on testing (`--model pro` was silently running on Flash the whole time before
this was caught and fixed).

`agy-ask.js` maps the documented `flash`/`pro` aliases to the exact strings `agy` accepts:

| Alias | Resolves to |
|---|---|
| `flash` (default) | `Gemini 3.5 Flash (Medium)` |
| `pro` | `Gemini 3.1 Pro (High)` |

Anything else is passed through as-is (for callers who want a specific model directly, e.g.
`Claude Opus 4.6 (Thinking)` — `agy` also serves non-Gemini models) but `agy-ask.js` prints a
warning to stderr, since an unrecognized value will silently no-op exactly like the `flash`/`pro`
bug did. Run `agy models` to see the full current list before using a raw name.

`agy` reports no token-usage figures at all (unlike the old `gemini` CLI) — nothing to surface.

---

## Security & Isolation

Agy-VN-Squad implements a defense-in-depth model for subprocess workers:

- **Auth Isolation**: `agy-ask.js` copies only the OAuth token (`~/.gemini/antigravity-cli/antigravity-oauth-token`)
  into a `chmod 700` scratch directory and points the subprocess's `$HOME` at it. Unlike the old
  `gemini` CLI, `agy` has no API-key auth and no dedicated config-dir override env var, so `$HOME`
  redirection is the isolation boundary. Cleanup runs via SIGTERM/SIGINT handlers, plus a
  synchronous `fs.rmSync` fallback in Node's `'exit'` handler for crash paths (the `'exit'` event
  only supports synchronous work, so an async cleanup call there would silently never finish).
- **Explicit workspace grant via `--add-dir`**: without `--add-dir <workDir>`, `agy` sandboxes
  *all* file writes into its own `$HOME/.gemini/antigravity-cli/scratch/` instead of the actual
  project directory — even though `cwd` is set correctly — because the isolated `$HOME` has no
  `trustedWorkspaces` entry for it. `agy-ask.js` passes `--add-dir <workDir>` explicitly (resolved
  to an absolute path) to grant real read/write access to the target directory. This was found via
  hands-on testing, not documentation — without it, every `[agy]` dispatch task would silently
  write its output into a scratch dir that then gets deleted by the adapter's own cleanup.
- **No MCP leakage by construction**: because the scratch `$HOME` never receives `settings.json`,
  `config/mcp_config.json`, or `plugins/`, the subprocess loads zero host MCP servers or plugins —
  no explicit "worker-safe settings" override file is needed (Gemini CLI required one; Antigravity
  doesn't).
- **Permission Scoping**: `claude-ask.js` defaults to a restricted allowlist (`Edit,Write,Glob,Grep,Read`). `Bash` is disabled by default to prevent shell-level exfiltration. Use `--unsafe` to opt-in to full permissions.
- **Worktree Isolation**: Each task dispatched via `/vn-dispatch` runs in an isolated git worktree to prevent uncommitted changes from leaking between agents.

## Performance & Reliability

- **Buffer Safety**: All adapters (`agy`, `claude`, `codex`) implement a 32MB buffer guard with truncation warnings to prevent silent data loss on large responses.
- **Print Timeout**: `agy-ask.js` passes `--print-timeout 15m` — `agy`'s own default is `5m0s`,
  after which it silently returns whatever output it has so far rather than erroring, which can
  truncate larger code-generation tasks.
- **Result Tracking**: `/vn-dispatch` follows a 3-file protocol (`.stdout.json`, `.stderr.log`, `.exit`) for reliable task monitoring and failure diagnosis.
- **Codex Guard**: `/vn-argue` includes a hard-stop on Codex unavailability to prevent debate loop failures.

---

## Known Limitations

- No `pro-exp` tier (the old `gemini` CLI had `flash`/`pro`/`pro-exp`; `agy` collapses this to
  just `flash`/`pro`).
- No token-usage reporting in `agy-ask.js`'s JSON output — `agy` doesn't provide it.
- `agy`'s lack of `--model` validation (see "Model Selection" above) means a typo'd model name
  will silently run on `agy`'s default rather than failing loudly. `agy-ask.js` warns on stderr
  for unrecognized values, but a caller not watching stderr won't notice.
- Live interactive-session skill discovery (`agy` → `/help` showing `/vn-agy` etc.) has not been
  verified end-to-end — only the file layout was confirmed to match Antigravity's documented
  discovery spec, and deploy/uninstall were tested against a scratch directory.

---

## Setup

### Prerequisites

- **Antigravity CLI** — see [antigravity.google/docs/cli-overview](https://antigravity.google/docs/cli-overview) for install, then run `agy` once to complete OAuth login (no API-key auth is available)
- **Claude CLI** (optional) — `npm install -g @anthropic-ai/claude-code`
- **Codex CLI** (optional) — `npm install -g codex-cli`

### Installation

```bash
git clone <this-repo>
cd vn-squad
bash agy-vnsq/scripts/deploy-agy-squad.sh
```

This copies each `agy-vnsq/skills/<name>/` directory as-is into Antigravity's native
customization root (`~/.agents/skills/` globally, or `<project>/.agents/skills/` for a workspace
install) rather than zipping and installing packages — see `agy-vnsq/scripts/deploy-agy-squad.sh`
for details. No `/skills reload` step is required; Antigravity re-scans customization roots
automatically.

### Uninstallation

```bash
bash agy-vnsq/scripts/uninstall-agy-squad.sh
```

---

## Recommended Workflow

1. `/vn-plan <feature>` — Decompose into TDD tasks.
2. `/vn-argue <design>` — Agree on design before coding.
3. `/vn-dispatch [agent] tasks` — Parallel agents implementation.
4. `/vn-verify` — Final verification gate.
5. `/vn-finish` — Merge and cleanup.

---

## License

MIT
