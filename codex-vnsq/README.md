# Codex-VNSQ

**Skills-native multi-agent orchestration for Codex. No Docker. No servers. Just skills.**

Codex leads the session, uses a compact skills pack for planning and coordination, and
delegates only the work that should be delegated. The package mirrors the structure of the
Claude-based workflow, but the Codex tree is self-contained and Codex-first.

---

## What This Package Is

`codex-vnsq` is the Codex-specific counterpart to the existing Claude workflow.

It provides:

- a Codex Tech Lead instruction file
- Codex-native skills for the core workflow
- headless adapters for Codex, Claude, and Gemini
- a deploy script for installing the package into a Codex home directory or a project

It does **not** replace the Claude workflow. Claude-specific files remain untouched.

---

## Core Skills

The main workflow skills live under `codex-vnsq/skills/`.

| Skill | What it does |
|---|---|
| `plan` | Breaks a task into small, testable TDD steps with concrete file paths and verification commands |
| `dispatch` | Splits independent work into parallel tasks with explicit routing annotations |
| `worktrees` | Creates isolated git worktrees with baseline setup and safety checks |
| `verify` | Requires fresh evidence before any completion claim |
| `review` | Requests structured code review with severity-ranked findings |
| `finish` | Verifies tests, presents completion choices, and cleans up the branch/worktree |
| `argue` | Runs a design debate loop and keeps `DESIGN.md` clean and reviewable |
| `scaffold` | Breaks oversized or repeatedly failing tasks into tiered subtasks |
| `claude` | Delegates a prompt to the Claude CLI headless adapter |
| `gemini` | Delegates a prompt to the Gemini CLI headless adapter |

---

## Files

| File or directory | Purpose |
|---|---|
| `codex-vnsq/AGENTS.md` | Codex Tech Lead instructions |
| `codex-vnsq/skills/*/SKILL.md` | Codex skill definitions |
| `scripts/codex-ask.js` | Headless Codex adapter with JSON output |
| `scripts/claude-ask.js` | Headless Claude adapter with JSON output |
| `scripts/gemini-ask.js` | Headless Gemini adapter with JSON output |
| `scripts/deploy-codex-vnsq.sh` | Installer for the Codex package |

---

## How It Works

The workflow is intentionally simple:

1. Codex reads the lead instructions in `codex-vnsq/AGENTS.md`.
2. A skill such as `plan` or `dispatch` is selected.
3. The skill provides the procedure and guardrails for that task.
4. The headless adapter `scripts/codex-ask.js` is available for scripted execution.
5. The Claude and Gemini adapters are available for worker delegation from Codex.
6. The deploy script copies the package into a target Codex home or project location.

The skills are prompt-based and modular, which makes them easy to extend without changing the
underlying runtime.

---

## Usage Examples

### Plan first

```text
Use the `plan` skill to break this feature into testable tasks.
```

### Debate a design

```text
Use the `argue` skill to decide between two implementation approaches before writing code.
```

### Dispatch parallel work

```text
Use the `dispatch` skill to split the job into independent tasks and route each one explicitly.
```

### Verify before finishing

```text
Use the `verify` skill to confirm the tests actually pass before claiming completion.
```

### Finish a branch

```text
Use the `finish` skill to verify, present options, and complete the branch cleanly.
```

---

## Installation

### Prerequisites

- Codex CLI installed and authenticated
- Git available
- Bash available

### Install into a target directory

```bash
bash scripts/deploy-codex-vnsq.sh /path/to/target
```

### Install into the default Codex home

```bash
bash scripts/deploy-codex-vnsq.sh
```

The installer copies:

- `AGENTS.md`
- `README.md`
- the Codex skill pack
- the headless adapter

---

## Headless Codex Adapter

Use the adapter when you want Codex output in a scriptable JSON envelope.

```bash
node scripts/codex-ask.js "what is 2+2"
```

Optional flags:

- `--model <name>` to select a model
- `--work-dir <path>` to run in a specific directory

The output includes:

- `summary`
- `model`
- `exitCode`
- `tokenUsage` when available

### Claude worker adapter

```bash
node scripts/claude-ask.js "review src/auth/token.js for race conditions"
```

### Gemini worker adapter

```bash
node scripts/gemini-ask.js "summarize the tradeoffs of SQLite vs Postgres for this app"
```

These adapters are what `/dispatch` and `/gemini` build on when Codex is the Tech Lead.

---

## Recommended Workflow

```text
1. plan      -> decompose the work
2. argue     -> settle the design
3. dispatch  -> split parallel work
4. worktrees -> isolate conflicting work
5. verify    -> prove it works
6. review    -> catch issues early
7. finish    -> merge or close out
```

---

## Directory Layout

```text
codex-vnsq/
├── AGENTS.md
├── README.md
├── scripts/
│   ├── claude-ask.js
│   ├── codex-ask.js
│   └── gemini-ask.js
└── skills/
    ├── claude/
    │   └── SKILL.md
    ├── argue/
    │   └── SKILL.md
    ├── dispatch/
    │   └── SKILL.md
    ├── finish/
    │   └── SKILL.md
    ├── plan/
    │   └── SKILL.md
    ├── review/
    │   └── SKILL.md
    ├── scaffold/
    │   └── SKILL.md
    ├── verify/
    │   └── SKILL.md
    ├── gemini/
    │   └── SKILL.md
    └── worktrees/
        └── SKILL.md
```
