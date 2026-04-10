---
name: vn-argue
description: Drive a structured adversarial debate between Gemini and Codex to stress-test a technical design before any code is written. Iterate until consensus or 3 rounds.
---

# /argue — Design Debate Loop (Gemini ↔ Codex)

*Sourced from VN-Squad v2 (Claude setup)*

Drive a structured adversarial debate between Gemini and Codex to stress-test a technical
design before any code is written. Iterate until consensus or max 3 rounds.

## Invocation

```
/argue [--codex-model <model>] [--rounds 3] <topic>
```

## Workflow

**Announce:** "Starting /argue debate (max 3 rounds): $TOPIC"

**Pre-flight: Branch check**
Before writing DESIGN.md, verify you are NOT on master or main.

### Round loop

**Step 1 — Draft / Refine design**

If `DESIGN.md` does not exist:
- Write `DESIGN.md` with Gemini's initial position on the topic.
- Structure: Problem Statement → Proposed Approach → Key Tradeoffs → Open Questions.

If `DESIGN.md` exists (subsequent rounds):
- Read the Codex findings from the previous round.
- For EACH finding: explicitly DEFEND, REVISE, or CONCEDE.
- Update `DESIGN.md` in-place. It stays a clean design doc.

**Step 2 — Commit**

```bash
git add DESIGN.md
git commit -m "argue: round $ROUND — $TOPIC"
```

**Step 3 — Adversarial review**

Run: `node gemini-vnsq/scripts/codex-ask.js "Perform an adversarial review of the current DESIGN.md. Look for security flaws, maintainability issues, or architectural weaknesses. Return a structured JSON finding." --model $CODEX_MODEL`

**Step 4 — Convergence check**

Stop if ANY of:
- Codex verdict is "APPROVE"
- Confidence >= 0.85
- Round >= 3

Otherwise increment round and return to Step 1.

## Convergence Output

When stopping, output:

```
## /argue — Debate Complete (Round $ROUND / 3)

**Verdict:** $VERDICT
**Agreed design:** DESIGN.md (committed to current branch)

**Next step options:**
1. `/dispatch` — implement the agreed design
2. Proceed with Gemini implementation
```
