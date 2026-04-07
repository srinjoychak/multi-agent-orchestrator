# VN-Squad v3

**Self-improving multi-agent orchestration for Claude Code. No Docker. No servers. Just skills and plain JSON.**

Claude Code (Tech Lead), Gemini CLI, and Codex collaborate through slash command skills — debating designs, dispatching parallel work, reviewing each other's output, and **learning from every dispatch** to route future tasks better.

---

## What's New in v3

v2 was a **silent system** — every dispatch started cold. No memory of what worked. No feedback from past outcomes.

v3 adds a self-improvement layer on top of v2 without changing any agent, skill, or worktree model:

| Capability | v2 | v3 |
|---|---|---|
| Dispatch outcome logging | ❌ | `.vn-squad/skill-registry.json` — every outcome persisted |
| Data-driven agent routing | Manual annotation only | Routing suggests overrides when data shows a better agent |
| Prompt evolution | Static AGENTS.md | `prompt-patches.json` — patches add/expire/graduate |
| Inter-agent knowledge sharing | ❌ | `CONTEXT_PROPOSAL` protocol → `session-context.json` |
| Trajectory memory | ❌ | success / recovery / pattern-confirmed chains |
| Skill discovery | Hardcoded commands list | `skill-manifest.json` — dynamically indexed |
| Audit trail | ❌ | `decisions.json` — every routing decision logged |
| Curriculum decomposition | ❌ | `/scaffold` skill for failed/oversized tasks |
| Status dashboard | ❌ | `/vn3-status` — routing, patches, plateau progress |

v1 (Docker + SQLite) → `archive/vn-squad-v1`. v2 (skills-native baseline) → still fully intact; v3 is purely additive.

---

## How v3 Self-Improvement Works

### The feedback loop (in plain terms)

```
You dispatch a task
    ↓
Agent completes (success or failure + failure_code)
    ↓
You log the outcome to skill-registry.json (one command)
    ↓
profile.js recomputes weighted_success_rate per agent per task-type
    ↓
routing.js compares against static defaults
    ↓
If a different agent consistently wins → suggest override
    ↓
You accept or reject → logged to decisions.json
    ↓
After ≥3 distinct task-type overrides accepted (plateau) → system is self-calibrated
```

### Weighted success rate formula

```
weighted_success_rate =
  (raw_successes + recovery_count + pattern_confirmed_count × 3)
  / max(1, total_samples + pattern_confirmed_count × 3)
```

Pattern-confirmed trajectories (same failure_code × task_type appearing 3+ times) are weighted 3× — they represent structural agent weaknesses, not noise.

### Routing override threshold

Override is suggested only when:
- Best alternative agent rate **≥ 0.7**
- Default AGENTS.md agent rate **< 0.5**
- Minimum **n = 3** samples for both agents

Below these thresholds: always use the static default (prevents noise-driven routing churn).

### Plateau milestone

The system is considered self-calibrated when `decisions.json` contains **≥ 3 distinct task_type entries** of type `routing_override_accepted` each with `outcome == success`, within the first 50 dispatch cycles. Check progress with `/vn3-status`.

---

## Skills

All skills live in `.claude/commands/` and are invoked as slash commands in Claude Code.

### Core Skills (v2 — unchanged)

| Skill | What it does |
|---|---|
| `/plan <task>` | Decompose into TDD bite-sized steps with exact file paths and code samples |
| `/dispatch <tasks>` | Dispatch independent tasks to parallel agents with routing annotations |
| `/argue <topic>` | Claude proposes design in `DESIGN.md` → Codex challenges → Claude refines → consensus |
| `/gemini <prompt> [--model flash\|pro\|pro-exp]` | Research, analysis, or large-context tasks via Gemini CLI |
| `/worktrees` | Create isolated git worktrees with safety checks |
| `/verify` | Gate: run actual verification before claiming completion |
| `/review` | Dispatch a structured code-reviewer subagent |
| `/finish` | Test-verified branch completion: merge locally, create PR, or discard |
| `/codex:rescue <task>` | Delegate implementation or fix to Codex |
| `/codex:adversarial-review` | Get Codex's adversarial structured critique of the current diff |

### New Skills (v3)

| Skill | What it does |
|---|---|
| `/scaffold <task>` | Break a failed or oversized task into 3-4 independently testable tiers via Gemini |
| `/vn3-status` | Dashboard: routing calibration, session context, patch status, plateau progress |

---

## Agents

| Sub-agent | Model | Isolation | Any task? |
|---|---|---|---|
| **claude-subagent** | session model | main worktree | ✅ |
| **gemini-worker** | flash (default), pro, pro-exp | per-task worktree | ✅ |
| **codex-worker** | provider default (gpt-5.4) | per-task worktree | ✅ |
| **vn-reviewer** | sonnet | main worktree | read-only |

**Any agent can do any task.** Route by what you want — not assumed capability.

### Dispatch annotation syntax

```
[claude]                task description
[gemini]                task description
[gemini --model pro]    task description
[codex]                 task description
[codex --model gpt-5.4-mini]  task description
```

---

## v3 Persistence Layer

All state lives in `.vn-squad/` as plain JSON. No databases. No daemons.

```
.vn-squad/
├── skill-registry.json          ← every dispatch outcome (active: last 6 months)
├── skill-registry-archive/      ← POSIX-atomic rotated archive (year-H1/H2)
├── session-context.json         ← live inter-agent knowledge (CONTEXT_PROPOSAL protocol)
├── decisions.json               ← full audit log of all Tech Lead routing decisions
├── prompt-patches.json          ← bounded lifecycle prompt evolution per agent
├── specialization-profile/
│   ├── gemini-worker.json       ← strengths, weaknesses, failure_modes
│   ├── codex-worker.json
│   └── claude-subagent.json
├── trajectories/
│   ├── success-<uuid>.json      ← APPROVE verdict dispatches
│   ├── recovery-<uuid>.json     ← failure→success recovery chains
│   └── pattern-confirmed-<uuid>.json  ← 3rd+ same failure pattern (weighted 3×)
├── skills/                      ← reusable solution snapshots (future)
└── skill-manifest.json          ← dynamic index of .claude/commands/ (committed)
```

`.gitignore` excludes all runtime state except `skill-manifest.json` (which is stable and committed).

---

## v3 Protocol Extensions (for agents)

### AGENT_RESULT block (extended in v3)

Every agent must emit this at the end of its response:

```
AGENT_RESULT:
  status: success | failure
  failure_code: EmptyDiff | CompileRed | TestFail | StaleBranch | PromptMisdelivery | ProviderFailure | none
  evidence: <single line describing what was observed>
  files_changed: <integer>
  quality_signals:
    review_verdict: APPROVE | REQUEST_CHANGES | not_run
    test_coverage: present | absent | unknown
```

### CONTEXT_PROPOSAL block (optional — agents may emit one per dispatch)

When an agent discovers a convention useful to sibling agents:

```
CONTEXT_PROPOSAL:
  key: conventions.<key_name>
  value: <primitive — string, boolean, or number>
  rationale: <one line>
```

Tech Lead accepts or rejects. Accepted proposals merge into `session-context.json`. Rejected keys are remembered — agents must not re-propose them.

### Recovery annotation

When retrying a failed task, the first line of the new prompt must be:

```
[RETRY: <original-task-uuid>]
```

---

## Usage Examples

### Example 1 — Standard dispatch + outcome logging

```
/dispatch
  [gemini --model pro]  implement the auth middleware (src/auth/index.js)
  [claude]              write tests for src/auth/index.js
  [codex]               review src/auth/index.js for security vulnerabilities
```

After completion, log each outcome:

```bash
npm run vn3:registry -- --append '{"agent":"gemini-worker","task_type":"code","outcome":"success","failure_code":"none","quality_signals":{"review_verdict":"APPROVE","files_changed":3}}'

npm run vn3:registry -- --append '{"agent":"claude-subagent","task_type":"test","outcome":"success","failure_code":"none","quality_signals":{"review_verdict":"APPROVE","files_changed":2}}'

npm run vn3:registry -- --append '{"agent":"codex-worker","task_type":"review","outcome":"success","failure_code":"none","quality_signals":{"review_verdict":"APPROVE","files_changed":0}}'
```

### Example 2 — Check if routing suggestions have emerged

```bash
npm run vn3:routing -- --status
```

Output after enough data:

```
── VN-Squad v3 Routing Status ──

[OVERRIDE]  code       → gemini-worker (preliminary, n=5, rate=0.80)
            default: claude-subagent (rate=0.33)
[default]   test       → claude-subagent
[default]   research   → gemini-worker
[default]   docs       → gemini-worker
[default]   debug      → claude-subagent
[default]   refactor   → claude-subagent
[OVERRIDE]  review     → claude-subagent (stable, n=12, rate=0.75)
            default: codex-worker (rate=0.40)
```

Accept an override (logs to decisions.json):
```bash
node -e "import('./scripts/vn3/decisions.js').then(m => m.appendDecision({type:'routing_override_accepted',agent:'gemini-worker',task_type:'code',reason:'Accepted Tech Lead override — 5 samples, 0.80 rate'}))"
```

### Example 3 — Handle a failed task with /scaffold

A task returned `EmptyDiff` twice:

```
/scaffold "refactor the entire payment module to use the repository pattern"
```

Gemini decomposes it into:
```
Tier 1: Define IPaymentRepository interface + PaymentRepository stub
Tier 2: Implement PaymentRepository with existing DB calls migrated
Tier 3: Swap all PaymentService call sites to use the new repository
Tier 4: Add integration tests for the full repository layer
```

Each tier dispatched and gated independently — no single oversized task.

### Example 4 — Accept an agent's CONTEXT_PROPOSAL

Agent returned:
```
CONTEXT_PROPOSAL:
  key: conventions.error_format
  value: throw new AppError(code, message)
  rationale: All existing handlers expect AppError shape — using plain Error breaks middleware
```

Accept it:
```bash
node -e "
import('./scripts/vn3/session-context.js').then(m => {
  m.addProposal({
    key: 'conventions.error_format',
    value: 'throw new AppError(code, message)',
    rationale: 'All existing handlers expect AppError shape',
    agent: 'gemini-worker'
  });
});
"
```

Now all subsequent dispatches in this session have `conventions.error_format` in their context.

### Example 5 — Full v3 workflow end-to-end

```
# 1. Start session
npm run vn3:init
node scripts/vn3/session-context.js --reset

# 2. Plan + design
/plan add rate limiting to the Express API
/argue should we use in-memory rate limiting or Redis?

# 3. Dispatch
/dispatch
  [claude]  implement rate limiter middleware per DESIGN.md
  [claude]  write integration tests for the rate limiter
  [gemini]  update API docs with rate limit headers

# 4. Log outcomes + recompute profiles
npm run vn3:registry -- --append '...'   (× 3)
npm run vn3:profile -- --recompute

# 5. Check status
/vn3-status

# 6. Verify + review + finish
/verify
/review
/finish  (→ create PR)
```

---

## Setup in a New Project

### Prerequisites

| Tool | Required | Install |
|---|---|---|
| **Claude Code** | ✅ | [claude.ai/code](https://claude.ai/code) |
| **Node.js v20+** | ✅ | `node --version` |
| **Gemini CLI** | Recommended | `npm install -g @google/gemini-cli` then `gemini auth` |
| **Codex plugin** | Recommended | Install codex-plugin-cc then `/codex:setup` in Claude Code |

### Step 1 — Copy VN-Squad into your project

Option A — as a git subtree (recommended, keeps history separate):
```bash
cd your-project
git subtree add --prefix=.vn-squad-system https://github.com/you/vn-squad master --squash
```

Option B — manual copy:
```bash
# Copy these into your project root:
cp -r vn-squad/.claude your-project/
cp -r vn-squad/scripts your-project/
cp    vn-squad/CLAUDE.md your-project/
cp    vn-squad/AGENTS.md your-project/
cp    vn-squad/agents.json your-project/
cp    vn-squad/package.json your-project/   # or merge scripts section
```

### Step 2 — Initialize the v3 persistence layer

```bash
cd your-project
node scripts/vn3/init-vn-squad.js
```

Expected output:
```
created .vn-squad/skill-registry.json
created .vn-squad/decisions.json
created .vn-squad/session-context.json
created .vn-squad/prompt-patches.json
created .vn-squad/specialization-profile/gemini-worker.json
created .vn-squad/specialization-profile/codex-worker.json
created .vn-squad/specialization-profile/claude-subagent.json
✓ .vn-squad/ initialized
```

### Step 3 — Generate skill manifest

```bash
node scripts/vn3/skill-manifest.js
```

This indexes all `.claude/commands/` skills. Re-run whenever you add a new skill.

### Step 4 — Add to .gitignore

The init script handles this, but verify your `.gitignore` includes:

```
.vn-squad/skill-registry.json
.vn-squad/skill-registry-archive/
.vn-squad/session-context.json
.vn-squad/decisions.json
.vn-squad/prompt-patches.json
.vn-squad/specialization-profile/
.vn-squad/trajectories/
.vn-squad/skills/
# skill-manifest.json is committed — do NOT ignore it
```

### Step 5 — Authenticate your agents

**Claude Code (Tech Lead):**
Already authenticated if you're using Claude Code.

**Gemini CLI:**
```bash
gemini auth
# Verify:
node scripts/gemini-ask.js "hello"
```

**Codex:**
```bash
# In Claude Code session:
/codex:setup
# If prompted to install:
# npm install -g @openai/codex
# Then authenticate per Codex plugin instructions
```

### Step 6 — Start a session

```bash
node scripts/vn3/session-context.js --reset
```

Open Claude Code in your project directory. The `CLAUDE.md` file is loaded automatically — you are now the Tech Lead.

---

## Session Workflow (every new session)

```bash
# Reset session context (clears proposals, seeds from last success conventions)
node scripts/vn3/session-context.js --reset

# Check if routing has any suggestions from prior sessions
npm run vn3:routing -- --status

# Check status dashboard
# (in Claude Code) /vn3-status
```

---

## npm Scripts Reference

```bash
npm run vn3:init          # Initialize .vn-squad/ (idempotent)
npm run vn3:manifest      # Regenerate skill-manifest.json
npm run vn3:registry      # Append/list registry entries
npm run vn3:profile       # Recompute specialization profiles
npm run vn3:routing       # Show routing calibration status
npm run vn3:archive       # Run archive migration (entries > 6 months)
npm run vn3:status        # Routing status table (alias for vn3:routing)
```

---

## v3 Scripts Reference

| Script | CLI flags | Purpose |
|---|---|---|
| `scripts/vn3/init-vn-squad.js` | _(none)_ | Idempotent bootstrap of all `.vn-squad/` artifacts |
| `scripts/vn3/skill-manifest.js` | _(none)_ | Scan `.claude/commands/` → `skill-manifest.json` |
| `scripts/vn3/registry.js` | `--append '{...}'`, `--list` | Atomic append of dispatch outcomes |
| `scripts/vn3/profile.js` | `--recompute` | Recompute per-agent specialization profiles |
| `scripts/vn3/routing.js` | `--status` | Print routing override suggestions |
| `scripts/vn3/session-context.js` | `--reset`, `--show` | Session lifecycle + CONTEXT_PROPOSAL processing |
| `scripts/vn3/archive.js` | `--run` | POSIX-atomic migrate entries > 6 months to archive |
| `scripts/vn3/decisions.js` | `--list` | Audit log read/append |
| `scripts/vn3/patches.js` | `--list` | Prompt-patch add/expire/graduate |
| `scripts/vn3/trajectories.js` | `--list` | Trajectory classification and capture |

---

## Using v3 with Each Agent

### Claude Code (Tech Lead)
The Tech Lead reads `skill-manifest.json` and `specialization-profile/` at session start to calibrate routing. Use `/vn3-status` to see current recommendations.

Key behaviors:
- Accepts or rejects CONTEXT_PROPOSALs from workers
- Logs routing decisions (accept/reject overrides) to `decisions.json`
- Calls `/scaffold` when a task has failed 2+ times
- Calls `/verify` before every `/finish`

### Gemini Worker
Invoked via `/dispatch` with `[gemini]` annotation. Operates in an isolated worktree.

Best at (prior to data): `research`, `docs`, `large-context analysis`

After data accumulates: routing.js tells you where Gemini actually outperforms Claude in your specific project.

```
# In dispatch:
[gemini --model pro]   analyze the security implications of the auth module
[gemini --model flash] write JSDoc for all exported functions in src/utils/
[gemini --model pro-exp] redesign the database schema for multi-tenancy
```

### Codex Worker
Invoked via `/dispatch` with `[codex]` annotation, or directly with `/codex:rescue`.

```
# In dispatch:
[codex]                          review src/auth/ for security vulnerabilities
[codex --model gpt-5.4-mini]    fix the failing unit test in auth.test.js

# Direct rescue:
/codex:rescue refactor the payment module per DESIGN.md
/codex:adversarial-review       (adversarial critique of current diff)
```

---

## Project Structure

```
your-project/
├── .claude/
│   ├── agents/
│   │   ├── gemini-worker.md      ← Gemini CLI sub-agent (isolation: worktree)
│   │   ├── codex-worker.md       ← Codex sub-agent (isolation: worktree)
│   │   └── vn-reviewer.md        ← Read-only reviewer
│   └── commands/
│       ├── argue.md              ← /argue   (design debate)
│       ├── dispatch.md           ← /dispatch (parallel agent routing)
│       ├── gemini.md             ← /gemini  (Gemini CLI)
│       ├── plan.md               ← /plan    (TDD decomposition)
│       ├── worktrees.md          ← /worktrees
│       ├── finish.md             ← /finish  (merge/PR)
│       ├── verify.md             ← /verify  (evidence gate)
│       ├── review.md             ← /review  (reviewer subagent)
│       ├── scaffold.md           ← /scaffold (v3 — curriculum decomposition)
│       └── vn3-status.md         ← /vn3-status (v3 — dashboard)
├── scripts/
│   ├── gemini-ask.js             ← Gemini CLI adapter
│   └── vn3/
│       ├── init-vn-squad.js      ← Bootstrap
│       ├── skill-manifest.js     ← Skill indexer
│       ├── registry.js           ← Outcome logging
│       ├── profile.js            ← Profile recompute
│       ├── routing.js            ← Routing suggestions
│       ├── session-context.js    ← Session + proposals
│       ├── archive.js            ← Registry archival
│       ├── decisions.js          ← Audit log
│       ├── patches.js            ← Prompt evolution
│       └── trajectories.js       ← Trajectory capture
├── .vn-squad/                    ← Runtime state (gitignored, except skill-manifest.json)
│   └── skill-manifest.json       ← Committed — stable skill index
├── CLAUDE.md                     ← Tech Lead instructions
├── AGENTS.md                     ← Subagent prompt standard
├── agents.json                   ← Agent capability map
└── package.json                  ← npm run vn3:* scripts
```

---

## Recommended Workflow

```
1. /plan <feature>              → TDD implementation steps
2. /argue <design question>     → Claude↔Codex consensus on DESIGN.md
3. /dispatch [agent] tasks      → parallel agents per task
4. Log outcomes → registry.js   → feeds the self-improvement loop
5. /verify                      → evidence gate before claiming done
6. /review                      → structured reviewer subagent
7. /finish                      → merge or PR
8. npm run vn3:profile          → recompute profiles after enough data
9. /vn3-status                  → check routing calibration progress
```

---

## System Compatibility

- **Developed on**: WSL2 (Ubuntu 22.04+), Node.js v24
- **macOS**: Works — all scripts use standard Node.js APIs and POSIX `mv`
- **Windows (Native)**: Use WSL2 — `mv --no-clobber` requires POSIX shell

---

## License

MIT
