# Codex-VN-Squad

**Skills-native multi-agent orchestration for Codex CLI. No Docker. No servers. Just skills.**

Codex, Claude Code, and Gemini CLI collaborate within your session through a curated set of
skills — debating designs, dispatching parallel work, and reviewing each other's output.

---

## Architecture

Codex-VN-Squad replicates the VN-Squad v2 orchestration model directly within Codex using
native skills and lightweight worker adapters.

| Capability | Implementation |
|---|---|
| Tech Lead | Codex CLI (via `codex-vnsq/AGENTS.md`) |
| Task execution | Codex skills plus subprocess workers |
| Design review | `vn-argue` — Codex<->Claude debate loop |
| Claude work | `scripts/claude-ask.js` (direct CLI) |
| Gemini work | `scripts/gemini-ask.js` (direct CLI) |
| Isolation | Git worktrees via `vn-worktrees` |

---

## Skills

All skills are implemented as Codex `SKILL.md` packages and installed into the local Codex
skills catalog.

| Skill | What it does |
|---|---|
| `vn-plan <task>` | Decompose into TDD bite-sized steps with exact file paths and code samples |
| `vn-dispatch <tasks>` | Dispatch independent tasks to parallel agents (Codex, Claude, Gemini) |
| `vn-scaffold <task>` | Decompose a complex task into tiered subtasks |
| `vn-argue <topic>` | Codex proposes design -> Claude challenges -> consensus loop |
| `vn-gemini <prompt>` | Direct Gemini CLI call for research or large-context work |
| `vn-claude <prompt>` | Direct Claude CLI call for second-opinion implementation or review |
| `vn-worktrees` | Create isolated git worktrees for parallel work |
| `vn-finish` | Test-verified branch completion (merge or PR) |
| `vn-verify` | Gate: run actual verification before claiming completion |
| `vn-review` | Request a structured code review |

---

## Agents

Three specialized worker scripts handle delegation:

| Agent | Script | CLI Required |
|---|---|---|
| `[codex]` | `scripts/codex-ask.js` | `codex` |
| `[claude]` | `scripts/claude-ask.js` | `claude` |
| `[gemini]` | `scripts/gemini-ask.js` | `gemini` |

---

## Security & Isolation

Codex-VN-Squad uses the same defense-in-depth model as the other vendor packages:

- **Auth Isolation**: `gemini-ask.js` prefers `GEMINI_API_KEY`. If OAuth is used, it creates a
  `chmod 700` temp directory and cleans it up on exit and signal handling.
- **Permission Scoping**: `claude-ask.js` defaults to a narrow allowlist
  (`Edit,Write,Glob,Grep,Read`). Use `--unsafe` only when the delegated task genuinely needs
  unrestricted tools.
- **Worktree Isolation**: Each task dispatched via `vn-dispatch` should run in an isolated git
  worktree to prevent uncommitted changes from leaking between workers.

## Performance & Reliability

- **Buffer Safety**: All adapters (`codex`, `claude`, `gemini`) implement a 32MB buffer guard
  with truncation warnings.
- **Result Tracking**: `vn-dispatch` follows a 3-file protocol
  (`.stdout.json`, `.stderr.log`, `.exit`) for reliable task monitoring and failure diagnosis.
- **Debate Guard**: `vn-argue` hard-stops if Claude is unavailable so Codex does not pretend a
  design debate completed when the review step never ran.

---

## Setup

### Prerequisites

- **Codex CLI** — installed and authenticated
- **Claude CLI** (optional) — `npm install -g @anthropic-ai/claude-code`
- **Gemini CLI** (optional) — `npm install -g @google/gemini-cli`

### Installation

```bash
git clone <this-repo>
cd copilot_adapter
bash codex-vnsq/scripts/deploy-codex-vnsq.sh
```

The installer copies:

- `codex-vnsq/AGENTS.md` -> `$CODEX_HOME/AGENTS.md`
- `codex-vnsq/skills/*` -> `$CODEX_HOME/skills/*`
- `codex-vnsq/scripts/*` -> `$CODEX_HOME/scripts/*`
- `config/gemini-settings.json` -> `$CODEX_HOME/config/gemini-settings.json`

If you pass a target path, the same layout is installed into that workspace instead of
`$CODEX_HOME`.

### Uninstallation

```bash
bash codex-vnsq/scripts/uninstall-codex-vnsq.sh
```

---

## Recommended Workflow

1. `vn-plan <feature>` — Decompose into TDD tasks.
2. `vn-argue <design>` — Agree on design before coding.
3. `vn-dispatch [agent] tasks` — Parallel agents implementation.
4. `vn-verify` — Final verification gate.
5. `vn-finish` — Merge and cleanup.

---

## License

MIT
