# DESIGN.md — VN-Squad v2: claw-code-parity Feature Adoption

## Problem Statement

VN-Squad v2 is a skills-native multi-agent orchestration system where Claude (Tech Lead)
coordinates Gemini and Codex workers via `/dispatch`, `/argue`, `/verify`, `/finish`, and
other skills. The system works but requires heavy manual supervision: the Tech Lead must
manually read agent failures, diagnose them, select a recovery agent, and re-dispatch.
Retries are ad-hoc, verification is binary, and worktree branches can silently drift from
master before `/finish` runs.

claw-code-parity's Orchestration Layer (Architecture 2) solves analogous problems in a
Rust CLI context: typed failure taxonomy, auto-recovery recipes, tiered green contracts,
per-worker state machines, and a policy engine for merge decisions.

This document decides which of those five patterns to adopt into VN-Squad v2, in what
form, and in what priority order.

---

## Proposed Approach

### Feature 1: RecoveryRecipes — ADOPT (highest priority)

**What:** After a dispatched agent returns, classify the failure type from its output and
auto-route to the correct recovery path — without requiring Tech Lead intervention.

**Form in VN-Squad v2:**

Failure classification is done by the Tech Lead (Claude) immediately after reading the
agent summary, using a fixed taxonomy:

| Failure type | Signal | Recovery action |
|---|---|---|
| `EmptyDiff` | git diff shows 0 files changed | Re-dispatch same task to [codex] |
| `CompileRed` | agent reports syntax/build error | `/codex:rescue` with error embedded |
| `TestFail` | tests fail in agent's worktree | `/argue` to revisit design assumption |
| `StaleBranch` | merge-base too far from master | `git merge master` then retry |
| `PromptMisdelivery` | agent asks clarifying questions | Re-dispatch with requirements re-embedded |
| `ProviderFailure` | agent returns empty/timeout | Fallback to next agent in routing table |

This is implemented as a new `/recovery` skill and referenced from `/dispatch`'s post-
processing step. The skill reads the agent summary, classifies it, and auto-dispatches the
recovery action — the Tech Lead approves before execution.

**Why this is highest priority:** The AGENTS.md already documents the manual recovery
logic ("retry with different agent or clarified requirements"). RecoveryRecipes simply
formalizes and accelerates a pattern already in use.

---

### Feature 2: GreenContract Tiers in `/verify` — ADOPT (medium priority)

**What:** Replace the binary pass/fail `/verify` gate with a 4-tier confidence ladder:
`TargetedTests → Package → Workspace → MergeReady`.

**Form in VN-Squad v2:**

`/verify` accepts a `--tier` flag:

```
/verify --tier targeted    # fast gate before /review (tests for changed files only)
/verify --tier package     # before /finish merge-locally
/verify --tier workspace   # before /finish create-PR
/verify --tier merge-ready # workspace green + /review completed + policy clear
```

`/finish` enforces minimum tiers:
- Merge locally → requires `package` green minimum
- Create PR → requires `workspace` green minimum
- MergeReady → requires `/review` to have returned no critical findings

**Why medium priority:** The current binary verify works. Tiers add precision but are not
blocking anything today. Valuable once dispatch volume increases.

---

### Feature 3: StaleBranchDetection in `/finish` — ADOPT (easy win)

**What:** Before running tests in `/finish`, check whether the current branch has diverged
from master and auto-merge-forward if so.

**Form in VN-Squad v2:**

Add Step 0 to `/finish` (before the existing Step 1: Verify Tests):

```bash
BASE=$(git merge-base HEAD master)
MASTER=$(git rev-parse master)
if [ "$BASE" != "$MASTER" ]; then
  echo "Branch is stale — merging master forward before tests"
  git merge master --no-edit
fi
```

If the merge produces conflicts, `/finish` stops and reports them rather than running
tests against a broken tree.

**Why adopt:** Low effort, prevents an entire class of "tests passed in isolation but
broke after merge" surprises. No new skill needed — a 5-line addition to `/finish`.

---

### Feature 4: Lane Status Files — DO NOT ADOPT (over-engineering)

**What:** Each dispatched agent writes a `lane_status.json` to its worktree at key
transitions (started, running, finished, failed) so the Tech Lead can poll mid-dispatch.

**Why not adopt:**

VN-Squad runs inside Claude Code's conversation loop, which is synchronous. The Tech Lead
cannot "poll mid-dispatch" — it waits for all Agent tool calls to return. Background
polling via CronCreate/RemoteTrigger is possible but adds infrastructure for a problem
that doesn't exist at current dispatch volumes (typically 2–5 parallel agents).

The Agent tool already returns structured output. The Tech Lead reads summaries serially
after dispatch completes. Lane status files would duplicate this with filesystem overhead
and no observable benefit until dispatch scales to 10+ simultaneous agents.

**Revisit when:** Dispatch volume exceeds 10 parallel agents or when async/background
dispatch is added to VN-Squad.

---

### Feature 5: PolicyEngine in `/finish` — PARTIAL ADOPT (low priority)

**What:** Replace the current "present 4 options to user" step in `/finish` with a
structured policy evaluation: if green + scoped + reviewed → auto-merge; if stale →
rebase first; if startup blocked → recover once then escalate.

**Form in VN-Squad v2 (partial):**

Do NOT fully automate the merge decision — VN-Squad operates under the constraint that
the Tech Lead never commits directly to master without user approval (CLAUDE.md rule).

Instead, add structured LaneContext evaluation to make the recommendation explicit:

```
PolicyEngine output (recommendation only — user approves):
  green_tier: package
  reviewed: yes (vn-reviewer returned no critical findings)
  stale: no
  → RECOMMENDED: merge locally (Option 1)
```

The user still approves. The PolicyEngine removes ambiguity about which option is
appropriate, but doesn't bypass human confirmation.

**Why partial:** Full auto-merge violates the CLAUDE.md constraint ("never commit directly
to master"). A recommendation engine is safe and still valuable.

---

## Key Tradeoffs

### T1: RecoveryRecipes adds a new skill vs. inline logic
Adding a `/recovery` skill keeps `/dispatch` clean but creates another file to maintain.
Alternative: embed recovery classification inline in `/dispatch`'s post-processing
instructions. **Decision: inline in `/dispatch` post-processing — fewer moving parts.**

### T2: GreenContract tiers add flag complexity to `/verify`
The `--tier` flag requires the Tech Lead to know which tier is appropriate. Risk: always
running `targeted` to save time, defeating the purpose.
**Mitigation:** `/finish` enforces minimum tiers automatically — the Tech Lead can't
skip `package` green before a local merge.

### T3: StaleBranchDetection auto-merge can fail with conflicts
An auto `git merge master --no-edit` in `/finish` could hit conflicts that obscure the
real task output. **Mitigation:** halt on conflict, report clearly, require manual
resolution before re-running `/finish`.

### T4: Lane status files rejected — risk of visibility blind spots
Without per-lane status files, there is no mid-dispatch visibility. A stuck agent (e.g.,
trust prompt unresolved) will block dispatch silently.
**Mitigation:** Add a max-wait timeout note to `/dispatch` instructions — if an agent
hasn't returned within N minutes, the Tech Lead should investigate manually.

### T5: Partial PolicyEngine — risk of always recommending the same option
If context is thin (no /review run, tier unknown), the PolicyEngine recommendation
defaults to "cannot determine — present all options." This is safe but unhelpful.
**Mitigation:** `/finish` checks whether `/review` was run in the current session before
computing the recommendation.

---

## Open Questions

1. Should RecoveryRecipes require Tech Lead approval before each recovery dispatch, or
   auto-fire for low-risk recoveries (EmptyDiff → codex retry) and require approval only
   for high-risk ones (TestFail → /argue)?

2. Should GreenContract tiers be enforced in the skill file (hard stop) or as advisory
   warnings (soft stop with user override)?

3. Where does the PolicyEngine state live? It needs to know: was `/review` run this
   session? What tier did `/verify` reach? Currently this is conversational context only —
   no persistent state. Is that sufficient?
