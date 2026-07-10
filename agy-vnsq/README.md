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

## Security & Isolation

Agy-VN-Squad implements a defense-in-depth model for subprocess workers:

- **Auth Isolation**: `agy-ask.js` copies only the OAuth token (`~/.gemini/antigravity-cli/antigravity-oauth-token`)
  into a `chmod 700` scratch directory and points the subprocess's `$HOME` at it. Unlike the old
  `gemini` CLI, `agy` has no API-key auth and no dedicated config-dir override env var, so `$HOME`
  redirection is the isolation boundary. Cleanup runs via SIGTERM/SIGINT handlers.
- **No MCP leakage by construction**: because the scratch `$HOME` never receives `settings.json`,
  `config/mcp_config.json`, or `plugins/`, the subprocess loads zero host MCP servers or plugins —
  no explicit "worker-safe settings" override file is needed (Gemini CLI required one; Antigravity
  doesn't).
- **Permission Scoping**: `claude-ask.js` defaults to a restricted allowlist (`Edit,Write,Glob,Grep,Read`). `Bash` is disabled by default to prevent shell-level exfiltration. Use `--unsafe` to opt-in to full permissions.
- **Worktree Isolation**: Each task dispatched via `/vn-dispatch` runs in an isolated git worktree to prevent uncommitted changes from leaking between agents.

## Performance & Reliability

- **Buffer Safety**: All adapters (`agy`, `claude`, `codex`) implement a 32MB buffer guard with truncation warnings to prevent silent data loss on large responses.
- **Result Tracking**: `/vn-dispatch` follows a 3-file protocol (`.stdout.json`, `.stderr.log`, `.exit`) for reliable task monitoring and failure diagnosis.
- **Codex Guard**: `/vn-argue` includes a hard-stop on Codex unavailability to prevent debate loop failures.

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
