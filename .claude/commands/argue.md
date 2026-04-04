# /argue — Design Debate Loop (Claude ↔ Codex)

Drive a structured adversarial debate between Claude and Codex to stress-test a technical
design before any code is written. Iterate until consensus or max rounds.

## Invocation

`/argue <topic>` — e.g. `/argue should we use ESM or CJS for this project`

## Workflow

**Announce:** "Starting /argue debate for: $TOPIC"

### Round loop (max 4 rounds)

**Step 1 — Draft / Refine design**

If `DESIGN.md` does not exist:
- Write `DESIGN.md` with Claude's initial position on the topic.
- Structure it as: Problem Statement → Proposed Approach → Key Tradeoffs → Open Questions.

If `DESIGN.md` exists (subsequent rounds):
- Read the Codex findings from the previous round.
- For each finding: explicitly DEFEND (explain why the concern is addressed), REVISE (update the design), or CONCEDE (note as unresolved).
- Update `DESIGN.md` in-place with the refined position.

**Step 2 — Commit**

```bash
git add DESIGN.md
git commit -m "argue: round $ROUND — $TOPIC"
```

**Step 3 — Adversarial review**

Run: `/codex:adversarial-review --wait`

Codex will return structured findings:
```json
{
  "verdict": "APPROVE" | "REVISE" | "REJECT",
  "confidence": 0.0–1.0,
  "findings": [{ "severity": "critical|major|minor", "description": "..." }]
}
```

**Step 4 — Convergence check**

Stop if ANY of:
- `verdict == "APPROVE"`
- `confidence >= 0.85`
- `round >= 4`

Otherwise increment round and return to Step 1.

## Convergence Output

When stopping, output:

```
## /argue — Debate Complete (Round $ROUND)

**Verdict:** $VERDICT  
**Confidence:** $CONFIDENCE

**Agreed design:** DESIGN.md (committed)

**Unresolved findings** (if any):
- [list any remaining REVISE/REJECT findings]

**Next step options:**
1. `/codex:rescue` — let Codex implement the agreed design
2. Continue arguing (increase max rounds)
3. Proceed with Claude implementation
```

## Rules

- Never skip a finding — address every one (defend, revise, or concede).
- Never implement code during the argue loop — only update DESIGN.md.
- If Codex is unavailable (codex-plugin-cc not installed), stop and say so clearly.
- DESIGN.md must remain a clean design document, not a debate transcript.
