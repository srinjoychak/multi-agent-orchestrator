# Gemini-VN-Squad

**Skills-native multi-agent orchestration for Gemini CLI. No Docker. No servers. Just skills.**

Gemini CLI, Claude Code, and Codex collaborate within your session through a curated set of
slash command skills — debating designs, dispatching parallel work, and reviewing each other's
output.

---

## Architecture

Gemini-VN-Squad replicates the VN-Squad v2 orchestration model directly within the Gemini CLI
using native skills.

| Capability | Implementation |
|---|---|
| Tech Lead | Gemini CLI (via `gemini-vnsq/GEMINI.md`) |
| Task execution | `gemini` CLI subagents (subprocess mode) |
| Design review | `/vn-argue` — Gemini↔Codex debate loop |
| Claude work | `scripts/claude-ask.js` (direct CLI) |
| Codex work | `scripts/codex-ask.js` (direct CLI) |
| Isolation | Git worktrees via `/vn-worktrees` |

---

## Skills

All skills are implemented as Gemini CLI `.skill` packages and invoked as slash commands.

| Skill | What it does |
|---|---|
| `/vn-plan <task>` | Decompose into TDD bite-sized steps with exact file paths and code samples |
| `/vn-dispatch <tasks>` | Dispatch independent tasks to parallel agents (Gemini, Claude, Codex) |
| `/vn-scaffold <task>` | Decompose a complex task into tiered subtasks |
| `/vn-argue <topic>` | Gemini proposes design → Codex challenges → consensus loop |
| `/vn-gemini <prompt>` | Direct Gemini CLI call (recursive or large-context) |
| `/vn-worktrees` | Create isolated git worktrees for parallel work |
| `/vn-finish` | Test-verified branch completion (merge or PR) |
| `/vn-verify` | Gate: run actual verification before claiming completion |
| `/vn-review` | Dispatch a code-reviewer subagent |

---

## Agents

Three specialized worker scripts handle delegation:

| Agent | Script | CLI Required |
|---|---|---|
| `[gemini]` | `scripts/gemini-ask.js` | `gemini` |
| `[claude]` | `scripts/claude-ask.js` | `claude` |
| `[codex]` | `scripts/codex-ask.js` | `codex` |

---

## Security & Isolation

Gemini-VN-Squad implements a defense-in-depth model for subprocess workers:

- **Auth Isolation**: `gemini-ask.js` prefers `GEMINI_API_KEY`. If OAuth is used, it creates a `chmod 700` tmpdir and ensures cleanup via SIGTERM/SIGINT handlers.
- **Permission Scoping**: `claude-ask.js` defaults to a restricted allowlist (`Edit,Write,Glob,Grep,Read`). `Bash` is disabled by default to prevent shell-level exfiltration. Use `--unsafe` to opt-in to full permissions.
- **Worktree Isolation**: Each task dispatched via `/vn-dispatch` runs in an isolated git worktree to prevent uncommitted changes from leaking between agents.

## Performance & Reliability

- **Buffer Safety**: All adapters (`gemini`, `claude`, `codex`) implement a 32MB buffer guard with truncation warnings to prevent silent data loss on large responses.
- **Result Tracking**: `/vn-dispatch` follows a 3-file protocol (`.stdout.json`, `.stderr.log`, `.exit`) for reliable task monitoring and failure diagnosis.
- **Codex Guard**: `/vn-argue` includes a hard-stop on Codex unavailability to prevent debate loop failures.

---

## Setup

### Prerequisites

- **Gemini CLI** — `npm install -g @google/gemini-cli` then `gemini auth`
- **Claude CLI** (optional) — `npm install -g @anthropic-ai/claude-code`
- **Codex CLI** (optional) — `npm install -g codex-cli`

### Installation

```bash
git clone <this-repo>
cd copilot_adapter
bash gemini-vnsq/scripts/deploy-gemini-squad.sh
```

After installation, run `/skills reload` in your interactive Gemini session.

### Uninstallation

```bash
bash gemini-vnsq/scripts/uninstall-gemini-squad.sh
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
