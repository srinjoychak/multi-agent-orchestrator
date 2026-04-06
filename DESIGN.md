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

Agents are required to emit a structured `AGENT_RESULT` block at the end of every summary:

```
AGENT_RESULT:
  status: success | failure
  failure_code: EmptyDiff | CompileRed | TestFail | StaleBranch | PromptMisdelivery | ProviderFailure | none
  evidence: <single line: error message, test output excerpt, or "none">
  files_changed: <integer>
```

This block is added to the standard prompt template in `AGENTS.md`. It is machine-readable
and does not rely on narrative prose interpretation.

The Tech Lead reads the `failure_code` field — not the prose summary — and routes:

| failure_code | Recovery action |
|---|---|
| `EmptyDiff` | Re-dispatch same task to [codex] with evidence embedded |
| `CompileRed` | `/codex:rescue` with evidence line embedded |
| `TestFail` | `/argue` to revisit design assumption |
| `StaleBranch` | Sync branch (see Feature 3), then retry |
| `PromptMisdelivery` | Re-dispatch with requirements fully re-embedded |
| `ProviderFailure` | Fallback to next agent in routing table |

Recovery dispatch for `EmptyDiff` and `ProviderFailure` (low-risk) fires automatically
after Tech Lead reads the code. Recovery for `CompileRed`, `TestFail`, and `PromptMisdelivery`
(higher-risk) requires one-line user confirmation before dispatch.

**Why structured codes over prose classification:** Free-form summary interpretation is
brittle — ambiguous or partial summaries can misclassify the failure type. A required
`AGENT_RESULT` block makes classification deterministic and removes the main failure
mode of the original design (Codex finding [medium]).

**Why this is highest priority:** The AGENTS.md already documents the manual recovery
logic ("retry with different agent or clarified requirements"). RecoveryRecipes formalizes
and accelerates a pattern already in use, with structured output preventing misrouting.

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

**Verification results are persisted to `.vn-squad/verify-state.json`**, keyed to the
current git commit hash:

```json
{
  "commit": "<sha>",
  "tier": "package",
  "timestamp": "<iso8601>",
  "review_passed": true,
  "review_commit": "<sha>"
}
```

`/finish` reads this file and validates that:
1. The stored `commit` matches the current `HEAD` (stale state = rejected, not trusted)
2. The stored `tier` meets the minimum for the chosen finish path
3. If `review_passed` is required (for MergeReady), the stored `review_commit` matches `HEAD`

This makes the safety gate deterministic across retries, interruptions, and agent swaps.
Conversational memory is no longer the authoritative source of truth (Codex finding [high]).

`/finish` enforces minimum tiers:
- Merge locally → requires `package` green minimum
- Create PR → requires `workspace` green minimum
- MergeReady → requires `/review` to have returned no critical findings for current HEAD

**Why medium priority:** The current binary verify works. Tiers add precision and the
durable state file solves the harder problem of non-deterministic session state.

---

### Feature 3: StaleBranchDetection in `/finish` — ADOPT (revised)

**What:** Before running tests in `/finish`, check whether the current branch has diverged
from the **remote-tracking** master (not local master) and synchronize explicitly before
tests run.

**Form in VN-Squad v2 (revised from Round 1):**

Add Step 0 to `/finish` (before the existing Step 1: Verify Tests):

```bash
# Fetch remote state first — local master may be stale
git fetch origin master

# Compare branch tip to remote master, not local master
REMOTE_MASTER=$(git rev-parse origin/master)
BASE=$(git merge-base HEAD origin/master)

if [ "$BASE" != "$REMOTE_MASTER" ]; then
  echo "Branch is stale vs origin/master — rebasing before tests"
  git rebase origin/master
fi
```

Rebase (not merge) is used to produce a linear history and avoid merge commits on feature
branches. If rebase hits conflicts, `/finish` halts and reports them — it does not run
tests against a broken or partially-resolved tree.

**Why rebase over merge:** A blind `git merge master --no-edit` against a stale local
master can certify a tree that is behind the remote. The revised design fetches origin
first and uses rebase to produce a deterministic, linear base (Codex finding [high]).

**Why adopt:** Prevents "tests passed in isolation but broke after merge" surprises. The
additional fetch step adds ~1 second and avoids an entire class of false-green finishes.

---

### Feature 4: Lane Status Files — DO NOT ADOPT (over-engineering)

**What:** Each dispatched agent writes a `lane_status.json` to its worktree at key
transitions (started, running, finished, failed) so the Tech Lead can poll mid-dispatch.

**Why not adopt:**

VN-Squad runs inside Claude Code's conversation loop, which is synchronous. The Tech Lead
cannot "poll mid-dispatch" — it waits for all Agent tool calls to return. Background
polling via CronCreate/RemoteTrigger is possible but adds infrastructure for a problem
that doesn't exist at current dispatch volumes (typically 2–5 parallel agents).

The structured `AGENT_RESULT` block (Feature 1) already provides machine-readable
per-agent outcome data post-dispatch. Lane status files would duplicate this with
filesystem overhead and no observable benefit until dispatch scales to 10+ simultaneous
agents or async dispatch is added.

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

Instead, `/finish` reads `.vn-squad/verify-state.json` (Feature 2) and computes a
structured recommendation:

```
PolicyEngine evaluation (recommendation only — user approves):
  verify_commit matches HEAD: yes
  green_tier: package
  review_passed: yes (commit matches HEAD)
  stale: no (rebased in Step 0)
  → RECOMMENDED: merge locally (Option 1)
```

If `verify_commit` does not match `HEAD` (e.g., after rebase changed the SHA), the
PolicyEngine flags this: "verification state is stale — re-run `/verify` before merge."
This prevents the stale-review silent-pass problem (Codex finding [high]).

The user still approves. The PolicyEngine removes ambiguity about which option is
appropriate without bypassing human confirmation.

**Why partial:** Full auto-merge violates the CLAUDE.md constraint ("never commit directly
to master"). A deterministic recommendation engine that reads durable state — not session
memory — is both safe and useful.

---

## Key Tradeoffs

### T1: Structured AGENT_RESULT block requires prompt template change
Adding `AGENT_RESULT` to AGENTS.md means every future agent dispatch must include the
block. Existing dispatches that don't emit it will be treated as `ProviderFailure` by
default (conservative fallback). **Decision: add to AGENTS.md template — one-time cost,
permanent benefit.**

### T2: `verify-state.json` invalidated by rebase SHA change
After Step 0 rebase in `/finish`, the HEAD SHA changes, which invalidates any pre-rebase
verify state. `/finish` must detect this and require re-verification before proceeding.
**Mitigation:** PolicyEngine explicitly checks `verify_commit == HEAD` and blocks with a
clear message if they diverge. This is the correct behavior — tests must be re-run on the
rebased HEAD anyway.

### T3: fetch + rebase in `/finish` requires network and clean working tree
`git fetch origin master` requires network access. `git rebase origin/master` requires a
clean working tree (no uncommitted changes). **Mitigation:** `/finish` checks `git status`
for uncommitted changes before Step 0 and halts with instructions if any exist.

### T4: GreenContract tiers add flag complexity to `/verify`
The `--tier` flag requires the Tech Lead to know which tier is appropriate. Risk: always
running `targeted` to save time.
**Mitigation:** `/finish` validates the tier from `verify-state.json` and enforces
minimums — the Tech Lead cannot skip `package` green before a local merge regardless of
which tier was last run.

### T5: Lane status files rejected — risk of visibility blind spots
Without per-lane status files, there is no mid-dispatch visibility. A stuck agent (e.g.,
trust prompt unresolved) will block dispatch silently.
**Mitigation:** Structured `AGENT_RESULT` blocks surface the outcome post-dispatch.
Add a max-wait note to `/dispatch` — if an agent hasn't returned within N minutes, the
Tech Lead investigates manually. Acceptable for current dispatch volumes.

---

## Open Questions

1. Should RecoveryRecipes auto-fire for low-risk failures (`EmptyDiff`, `ProviderFailure`)
   without any confirmation, or always require one-line user approval for auditability?
   Current design: auto-fire for low-risk, confirm for high-risk. Is the distinction worth
   the asymmetry?

2. Should `verify-state.json` be committed to the branch or kept as an untracked file?
   Committed: reviewers can see what verification ran. Untracked: simpler, no noise in git
   history. Current design: untracked (`.vn-squad/` in `.gitignore`).

3. What is the `AGENT_RESULT` behavior for agents that predate this change (no block
   emitted)? Current design: treat as `ProviderFailure` (conservative). Alternative:
   treat as `success` (optimistic, backward-compatible). Which is less dangerous?
