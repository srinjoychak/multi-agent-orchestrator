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
| `/gemini <prompt> [--model flash\|pro\|pro-exp]` | Research, analysis, or large-context tasks via Gemini CLI |

### From [skills.sh](https://skills.sh) — obra/superpowers

| Skill | What it does |
|---|---|
| `/plan <task>` | Decompose into TDD bite-sized steps with exact file paths and code samples |
| `/dispatch <tasks>` | Dispatch independent tasks to parallel agents — supports agent routing annotations |
| `/worktrees` | Create isolated git worktrees with safety checks and baseline tests |
| `/finish` | Test-verified branch completion: merge locally, create PR, or discard |
| `/verify` | Gate: run actual verification before claiming anything is complete |
| `/review` | Dispatch a code-reviewer subagent with structured Critical/Important/Minor feedback |

### From codex-plugin-cc (OpenAI)

| Command | What it does |
|---|---|
| `/codex:rescue <task> [--model <model>]` | Delegate an implementation or fix to Codex |
| `/codex:adversarial-review` | Get Codex's structured adversarial critique of the current diff |
| `/codex:review` | Standard Codex code review |

---

## Agents

Four collaborators, implemented as native Claude Code sub-agents:

| Sub-agent | Definition | Any task? | Model flag | Isolation |
|---|---|---|---|---|
| **claude-subagent** | built-in | ✅ | `/model opus\|sonnet\|haiku` in CC session | main worktree |
| **gemini-worker** | `.claude/agents/gemini-worker.md` | ✅ | `[gemini --model flash\|pro\|pro-exp]` | per-task worktree |
| **codex-worker** | `.claude/agents/codex-worker.md` | ✅ | `[codex --model gpt-5.4-mini\|gpt-5.3-codex-spark]` | per-task worktree |
| **vn-reviewer** | `.claude/agents/vn-reviewer.md` | read-only | inherits session | main worktree |

**Any agent can do any task.** Gemini writes code. Codex writes tests. Claude does research.
Route by what you want — not by assumed capability.

### Agent Routing

No percentage quotas. No hardcoded task-type defaults. Routing is entirely by **your explicit annotation** in `/dispatch`.

```
[gemini --model pro]   write the authentication module      ← coding task → Gemini
[claude]               write tests for the auth module      ← testing task → Claude  
[codex]                implement the rate limiter           ← coding task → Codex
[gemini --model flash] write the API documentation         ← docs task → Gemini
```

All four tasks run in parallel. `gemini-worker` and `codex-worker` each get their own
isolated git worktree (via `isolation: worktree` in their sub-agent definition).

No annotation = Claude (the session default).

---

## Usage Examples

### Example 1 — Design debate before coding

```
You: /argue should we use ESM or CJS for this Node.js project?
```

What happens:
1. Claude writes `DESIGN.md` with its position (ESM recommended, rationale)
2. Commits `DESIGN.md`
3. Codex reviews it adversarially — finds: "CJS still required for Jest without config"
4. Claude refines — updates DESIGN.md to address the finding
5. Codex approves on round 2 (verdict: APPROVE, confidence: 0.88)

Result: `DESIGN.md` committed with agreed-upon approach. Both AIs signed off.

```
You: /codex:rescue implement the module system per DESIGN.md
```

---

### Example 2 — Research then build

```
You: /gemini --model pro what are the tradeoffs of Drizzle ORM vs Prisma for a SQLite project?
```

Gemini returns a structured comparison (large context, free tier).

```
You: /argue based on the Gemini research, should we use Drizzle or Prisma?
```

Claude takes a position. Codex stress-tests it. Consensus in 2 rounds.

```
You: /plan implement the chosen ORM with migrations and a users table
```

Returns 4 tasks with TDD steps and exact file paths.

```
You: /dispatch
  [claude] Task 1: write the schema and migration
  [claude] Task 2: write the repository layer
```

Two Claude subagents work in parallel.

---

### Example 3 — Parallel independent fixes

```
You: /dispatch
  [claude] fix the type error in src/auth/token.js line 42
  [claude] add missing error handling in src/api/users.js
  [gemini] write JSDoc for all exported functions in src/utils/
```

Three agents work simultaneously. Each commits its own changes independently.

---

### Example 4 — Gemini with model selection

```
You: /gemini --model flash "summarize the last 50 git commits"
# fast + cheap for simple summarization

You: /gemini --model pro "analyze the security implications of the auth middleware"
# more capable model for security analysis
```

---

### Example 5 — Codex with model selection

```
You: /codex:rescue --model gpt-5.4-mini fix the failing unit test in auth.test.js
# lighter model for a targeted fix

You: /codex:rescue --model gpt-5.3-codex-spark refactor the entire payment module
# more capable model for complex refactoring
```

---

### Example 6 — Claude model selection for heavy tasks

Change the Claude Code session model before dispatching:

```
/model opus          ← switch Tech Lead + all subagents to Opus

/dispatch
  [claude] redesign the entire authentication architecture
  [claude] write a comprehensive test suite for the new design

/model sonnet        ← switch back after heavy work
```

> **Note:** The Claude Code Task tool always uses the current session model.
> All `[claude]` subagents inherit whatever model you've set. There's no per-subagent
> model override without switching to subprocess mode.

---

### Example 7 — Full workflow end-to-end

```
/plan add rate limiting to the Express API

→ /argue should we use in-memory rate limiting or Redis?
  (3 rounds, DESIGN.md: in-memory for now, Redis interface for later)

→ /dispatch
    [claude] implement the rate limiter middleware per DESIGN.md
    [claude] write integration tests for the rate limiter
    [gemini] update the API documentation with rate limit headers

→ /verify
→ /review
→ /finish  (creates PR)
```

---

## Model Selection Reference

| Agent | Flag | Options | Default |
|---|---|---|---|
| Gemini | `--model` | `flash`, `pro`, `pro-exp` | `flash` |
| Codex | `--model` | `gpt-5.4-mini`, `gpt-5.3-codex-spark`, others | provider default |
| Claude subagents | `/model` (CC command) | `opus`, `sonnet`, `haiku` | session model |

---

## Recommended Workflow

```
1. /plan <feature>            → structured TDD implementation steps
2. /argue <design question>   → agree on design before writing code
3. /dispatch [agent] tasks    → parallel agents, routed by capability
4. /codex:rescue or /gemini   → targeted Codex/Gemini work
5. /verify                    → evidence gate before claiming done
6. /review                    → reviewer subagent
7. /finish                    → merge or PR
```

---

## Setup

### Prerequisites

- **Claude Code** — installed and authenticated (the Tech Lead)
- **codex-plugin-cc** — for `/codex:*` commands ([openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc))
- **Gemini CLI** (optional) — `npm install -g @google/gemini-cli` then `gemini auth`

### Install

```bash
git clone <this-repo>
cd vn-squad
# No npm install needed — zero runtime dependencies
```

### Verify setup

```bash
# Test Gemini adapter
node scripts/gemini-ask.js "what is 2+2"

# Test model flag
node scripts/gemini-ask.js "what is 2+2" --model pro

# Verify codex-plugin-cc
/codex:setup
```

---

## Project Structure

```
vn-squad/
├── .claude/
│   ├── agents/                 ← Native Claude Code sub-agent definitions
│   │   ├── gemini-worker.md    ← Gemini CLI wrapper (isolation: worktree, model: haiku)
│   │   ├── codex-worker.md     ← Codex wrapper (isolation: worktree, model: haiku)
│   │   └── vn-reviewer.md      ← Read-only code reviewer (model: sonnet, memory: project)
│   └── commands/               ← Slash command skills
│       ├── argue.md            ← /argue   (Claude↔Codex design debate)
│       ├── gemini.md           ← /gemini  (direct Gemini CLI call)
│       ├── dispatch.md         ← /dispatch (agent routing with annotations)
│       ├── plan.md             ← /plan    (skills.sh)
│       ├── worktrees.md        ← /worktrees (skills.sh)
│       ├── finish.md           ← /finish  (skills.sh)
│       ├── verify.md           ← /verify  (skills.sh)
│       └── review.md           ← /review  (skills.sh)
├── scripts/
│   └── gemini-ask.js           ← Gemini CLI adapter (used by gemini-worker)
├── config/
│   └── gemini-settings.json    ← Worker-safe Gemini config
├── CLAUDE.md                   ← Tech Lead instructions
├── AGENTS.md                   ← Subagent prompt standard
└── agents.json                 ← Agent capabilities + sub-agent map
```

---

## System Compatibility

- **Developed on**: WSL2 (Ubuntu 22.04+)
- **macOS**: Should work; Gemini adapter uses standard Node.js APIs
- **Windows (Native)**: Untested — use WSL2

---

## License

MIT
