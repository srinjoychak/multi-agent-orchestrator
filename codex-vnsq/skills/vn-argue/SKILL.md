---
name: vn-argue
description: Drive a structured adversarial debate between Codex and Claude to stress-test a technical design before any code is written. Iterate until consensus or 4 rounds.
---

# `vn-argue` — Design Debate Loop (Codex <-> Claude)

Drive a structured adversarial debate between Codex and Claude to stress-test a technical
design before any code is written. Iterate until consensus or max 4 rounds.

## Invocation

```text
vn-argue [--claude-model <model>] [--rounds 4] <topic>
```

## Workflow

Announce: `Starting vn-argue debate (max 4 rounds): $TOPIC`

### Step 1 — Draft or refine design

If `DESIGN.md` does not exist:
- Write `DESIGN.md` with Codex's initial position on the topic.
- Structure: Problem Statement -> Proposed Approach -> Key Tradeoffs -> Open Questions.

If `DESIGN.md` exists:
- Read the Claude findings from the previous round.
- For each finding: explicitly DEFEND, REVISE, or CONCEDE.
- Update `DESIGN.md` in place. Keep it as a clean design doc.

### Step 2 — Commit

```bash
git add DESIGN.md
git commit -m "argue: round $ROUND - $TOPIC"
```

### Step 3 — Adversarial review

Run:

```bash
node codex-vnsq/scripts/claude-ask.js "Perform an adversarial review of the current DESIGN.md. Look for security flaws, maintainability issues, or architectural weaknesses. Return a structured JSON finding." --model "$CLAUDE_MODEL"
```

If `claude-ask.js` exits non-zero, or output cannot be parsed as JSON:
- Stop.
- Tell the user Claude is unavailable and the design debate could not complete.

### Step 4 — Convergence check

Stop if any of:
- Claude verdict is `APPROVE`
- Confidence >= `0.85`
- Round >= `4`

Otherwise increment round and return to Step 1.
