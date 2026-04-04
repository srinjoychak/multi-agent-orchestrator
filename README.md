# VN-Squad v2

**Skills-native multi-agent orchestration for Claude Code. No Docker. No servers. Just skills.**

Claude Code, Gemini CLI, and Codex collaborate within your session through a curated set of
slash command skills — debating designs, dispatching parallel work, and reviewing each other's
output.

---

## What Changed in v2

VN-Squad v1 used Docker containers, SQLite, and an MCP server to orchestrate agents.
It worked, but it was complex (~5200 LOC) and brittle.

v2 makes a different bet: **Claude Code's native session model is already good enough.**
Subagents, skill routing, and iterative review don't need infrastructure — they need good prompts.

| Capability | v1 (Docker + MCP) | v2 (Skills-native) |
|---|---|---|
| Task execution | Docker containers | Claude Code subagents via Task tool |
| Design review | ❌ | `/argue` — Claude↔Codex debate loop |
| Gemini work | worker-gemini image | `scripts/gemini-ask.js` (direct CLI) |
| Codex work | worker-codex image | codex-plugin-cc (`/codex:rescue`) |
| State tracking | SQLite task machine | Session + git log |
| Infrastructure | Docker, Node.js server | Zero |

v1 is preserved on the `archive/vn-squad-v1` branch if you need it.

---

## Skills

All skills live in `.claude/commands/` and are invoked as slash commands in Claude Code.

### Custom Skills

| Skill | What it does |
|---|---|
| `/argue <topic>` | Claude proposes a design in `DESIGN.md` → Codex challenges it → Claude refines → repeat until consensus (max 4 rounds) |
| `/gemini <prompt>` | Research, analysis, or large-context tasks via Gemini CLI (no Docker) |

### From [skills.sh](https://skills.sh) — obra/superpowers

| Skill | What it does |
|---|---|
| `/plan <task>` | Decompose into TDD bite-sized steps with exact file paths and code samples |
| `/dispatch <tasks>` | Dispatch 3+ independent tasks to parallel Claude subagents |
| `/worktrees` | Create isolated git worktrees with safety checks and baseline tests |
| `/finish` | Test-verified branch completion: merge locally, create PR, or discard |
| `/verify` | Gate: run actual verification before claiming anything is complete |
| `/review` | Dispatch a code-reviewer subagent with structured Critical/Important/Minor feedback |

### From codex-plugin-cc (OpenAI)

| Command | What it does |
|---|---|
| `/codex:rescue <task>` | Delegate an implementation or fix to Codex |
| `/codex:adversarial-review` | Get Codex's structured adversarial critique of the current diff |
| `/codex:review` | Standard Codex code review |

---

## Agents

Three collaborators, no containers:

| Agent | How | Best for |
|---|---|---|
| **claude-subagent** | Task tool (native Claude Code) | Code, refactor, test, debug, review |
| **codex** | codex-plugin-cc | Adversarial review, rescue, complex fixes |
| **gemini** | `scripts/gemini-ask.js` subprocess | Research, analysis, large-context docs |

---

## Recommended Workflow

```
1. /plan <feature>
   → structured implementation steps

2. /argue <design question>   ← if design is unclear
   → DESIGN.md agreed by both Claude and Codex

3. /dispatch                  ← for parallel independent tasks
   → multiple subagents work simultaneously

4. /codex:rescue <task>       ← for Codex-strength work
   /gemini <prompt>           ← for research/analysis

5. /verify                    ← before claiming anything is done
6. /review                    ← reviewer subagent eyes on the code
7. /finish                    ← merge or PR
```

---

## Setup

### Prerequisites

- **Claude Code** — installed and authenticated (the Tech Lead)
- **codex-plugin-cc** — for `/codex:*` commands ([openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc))
- **Gemini CLI** (optional, for `/gemini`) — `npm install -g @google/gemini-cli` then `gemini auth`

### Install

```bash
git clone <this-repo>
cd vn-squad
# No npm install needed — zero runtime dependencies
```

### Test Gemini adapter

```bash
node scripts/gemini-ask.js "what is 2+2"
```

---

## Project Structure

```
vn-squad/
├── .claude/
│   └── commands/          ← All slash command skills
│       ├── argue.md        ← /argue  (custom)
│       ├── gemini.md       ← /gemini (custom)
│       ├── plan.md         ← /plan   (skills.sh)
│       ├── dispatch.md     ← /dispatch (skills.sh)
│       ├── worktrees.md    ← /worktrees (skills.sh)
│       ├── finish.md       ← /finish (skills.sh)
│       ├── verify.md       ← /verify (skills.sh)
│       └── review.md       ← /review (skills.sh)
├── scripts/
│   └── gemini-ask.js       ← Gemini CLI adapter (no Docker)
├── config/
│   └── gemini-settings.json ← Worker-safe Gemini config
├── CLAUDE.md               ← Tech Lead instructions
├── AGENTS.md               ← Subagent prompt standard
└── agents.json             ← Agent capabilities map
```

---

## System Compatibility

- **Developed on**: WSL2 (Ubuntu 22.04+)
- **macOS**: Should work; Gemini adapter uses standard Node.js APIs
- **Windows (Native)**: Untested — use WSL2

---

## License

MIT
