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

**Form in VN-Squad v2 (revised — tiered-trust classification):**

Failure classification uses a **tiered trust model** that acknowledges a fundamental
architectural constraint: in VN-Squad, the Tech Lead receives agent output only through
the Claude Code Task tool's return value. There is no separate subprocess runner the Tech
Lead can intercept for raw exit codes or build logs. The agent IS the runner.

Given this constraint, classification uses three tiers of evidence, ordered by reliability:

**Tier 1 — Fully independent (highest trust):**

| Signal | How checked | Trust level |
|---|---|---|
| Files changed | `git diff --stat <worktree-branch>` run by Tech Lead directly | Fully independent — agent cannot influence |
| Summary presence | Is the agent return value non-empty? | Independent |

**Tier 2 — Agent-authored but structurally verifiable:**

| Signal | How checked | Trust level |
|---|---|---|
| `AGENT_RESULT.files_changed` | Cross-check against Tier 1 git diff count | Low — accept only if matches Tier 1 |
| `AGENT_RESULT.failure_code` | Used only when Tier 1 agrees | Advisory |

**Tier 3 — Agent-authored, unverifiable (lowest trust):**

| Signal | How checked | Trust level |
|---|---|---|
| Exit code in summary text | Agent writes `exit: N` in prose | Unverifiable — agent-controlled |
| Error patterns in summary | Pattern match on "error:", "SyntaxError" | Unverifiable — agent-controlled |

**Classification rules:**

- `EmptyDiff`: Tier 1 git diff returns 0 files. Fully independent. Auto-recovery, no approval.
- `ProviderFailure`: Agent summary is empty/truncated (Tier 1 presence check). Auto-fallback, no approval.
- `StaleBranch`: Tier 1 merge-base check shows divergence. Mechanical fix, no approval.
- `CompileRed` / `TestFail` / `PromptMisdelivery`: **Cannot be independently verified** in VN-Squad's architecture. These require Tech Lead human judgment on the summary + mandatory user approval before recovery dispatch. The Tech Lead reads the summary, assesses plausibility, and confirms before acting.

**Explicit architectural concession:** Full independence for `CompileRed` and `TestFail`
classification is not achievable within VN-Squad's Task-tool architecture. The design
does not pretend otherwise. For these failure types, user approval is the safeguard —
a human reads the evidence and decides, rather than automated routing from unverifiable
agent-authored text.

**Agent `AGENT_RESULT` block (advisory — corroborating only):**

Agents emit:
```
AGENT_RESULT:
  status: success | failure
  failure_code: EmptyDiff | CompileRed | TestFail | StaleBranch | PromptMisdelivery | ProviderFailure | none
  evidence: <single line>
  files_changed: <integer>
```

Missing or malformed blocks → treat as "unclassified", not `ProviderFailure`. Apply
Tier 1 signals only. `ProviderFailure` is reserved for genuinely empty/truncated summaries.

**Routing table:**

| Classification | Primary signal | Recovery action | Approval required? |
|---|---|---|---|
| `EmptyDiff` | Tier 1: git diff (0 files) | Re-dispatch to [codex] | No |
| `ProviderFailure` | Tier 1: empty/truncated summary | Fallback agent | No |
| `StaleBranch` | Tier 1: merge-base check | Sync (Feature 3), retry | No |
| `CompileRed` | Tier 3 + human judgment | `/codex:rescue` with evidence | Yes |
| `TestFail` | Tier 3 + human judgment | `/argue` to revisit design | Yes |
| `PromptMisdelivery` | Tier 3 + human judgment | Re-dispatch with full requirements | Yes |

**Why this is highest priority:** The AGENTS.md already documents the manual recovery
logic. This formalizes it with explicit trust tiers and preserves human oversight for
the cases that cannot be independently verified.

**Why this is highest priority:** The AGENTS.md already documents the manual recovery
logic. This formalizes it with independent verification.

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

**Verification results are persisted atomically to `.vn-squad/verify-state.json`**,
written via temp-file-plus-rename to prevent partial writes:

```bash
# Atomic write pattern (used by /verify skill)
TMPFILE=$(mktemp .vn-squad/verify-state.XXXXXX)
cat > "$TMPFILE" << EOF
{
  "schema_version": 1,
  "run_id": "<uuid>",
  "head_commit": "<sha of HEAD at verify time>",
  "upstream_base": "<sha of origin/master at verify time>",
  "tier": "package",
  "timestamp": "<iso8601>",
  "review_passed": true,
  "review_commit": "<sha>"
}
EOF
mv "$TMPFILE" .vn-squad/verify-state.json
```

Key fields:
- `head_commit` — the exact HEAD that was tested. `/finish` validates this matches current HEAD.
- `upstream_base` — the `origin/master` SHA at verify time. After Step 0 rebase in `/finish`, if HEAD changes, the stored `head_commit` is stale and `/finish` blocks.
- `schema_version` — allows future schema evolution without silent misreads.
- `run_id` — unique per verify run; guards against concurrent verify collisions.

**`/finish` gate logic (reads verify-state.json):**

1. Read and parse `verify-state.json` — fail loudly if missing, malformed, or wrong `schema_version`
2. Validate `head_commit == git rev-parse HEAD` — if rebase changed HEAD, block and require re-verify
3. Validate `tier` meets minimum for the chosen finish path
4. If `merge-ready` path: validate `review_passed == true` AND `review_commit == HEAD`

This makes the safety gate deterministic and reproducible — no session memory required.

**Why medium priority:** The durable state file solves the harder non-determinism problem
and is a prerequisite for a trustworthy PolicyEngine (Feature 5).

---

### Feature 3: StaleBranchDetection in `/finish` — ADOPT (revised)

**What:** Before running tests in `/finish`, fetch the remote and synchronize the branch
against `origin/master` via rebase — not a blind local-master merge.

**Form in VN-Squad v2:**

Add Step 0 to `/finish` (before the existing Step 1: Verify Tests):

```bash
# Require clean working tree before touching the branch
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes detected — commit or stash before /finish"
  exit 1
fi

# Fetch remote state — local master may be stale
git fetch origin master

# Compare to remote master, not local master
REMOTE_MASTER=$(git rev-parse origin/master)
BASE=$(git merge-base HEAD origin/master)

if [ "$BASE" != "$REMOTE_MASTER" ]; then
  echo "Branch is stale vs origin/master — rebasing before tests"
  git rebase origin/master
  # After rebase, HEAD SHA has changed — verify-state.json is now stale
  # /finish will block at the verify gate and require re-verify
fi
```

Rebase (not merge) produces a linear history. If rebase hits conflicts, `/finish` halts
and reports them — tests do not run against a broken tree.

**Post-rebase consequence:** Rebase changes the HEAD SHA, which invalidates
`verify-state.json`. This is intentional and correct — tests ran against the pre-rebase
tree, not the post-rebase tree. The Tech Lead re-runs `/verify --tier package` after
successful rebase before proceeding.

**Why rebase + remote-fetch over local merge:** A blind `git merge master --no-edit`
against stale local master can certify a tree behind the remote. Fetching first and
rebasing produces a deterministic, forward-only base.

---

### Feature 4: Lane Status Files — DO NOT ADOPT (over-engineering)

**What:** Each dispatched agent writes a `lane_status.json` to its worktree at key
transitions (started, running, finished, failed) so the Tech Lead can poll mid-dispatch.

**Why not adopt:**

VN-Squad runs inside Claude Code's conversation loop, which is synchronous. The Tech Lead
cannot "poll mid-dispatch" — it waits for all Agent tool calls to return. The dual-signal
classification in Feature 1 already provides machine-readable per-agent outcome data
post-dispatch via external signal verification + advisory `AGENT_RESULT` blocks.

Lane status files would duplicate this with filesystem overhead and no observable benefit
until dispatch scales to 10+ simultaneous agents or async dispatch is added.

**Revisit when:** Dispatch volume exceeds 10 parallel agents or async background dispatch
is introduced to VN-Squad.

---

### Feature 5: PolicyEngine in `/finish` — PARTIAL ADOPT (low priority)

**What:** Structured policy evaluation that reads durable state and produces a
deterministic recommendation — not a guess from session memory.

**Form in VN-Squad v2 (partial):**

Do NOT fully automate the merge decision (CLAUDE.md constraint: Tech Lead never commits
to master without user approval). Instead, `/finish` computes a recommendation by reading
`verify-state.json` after Step 0 rebase:

```
PolicyEngine evaluation (recommendation only — user approves):
  head_commit matches current HEAD: yes
  upstream_base matches current origin/master: yes
  green_tier: package
  review_passed: yes (review_commit matches HEAD)
  stale: no (rebased in Step 0, verify re-ran post-rebase)
  → RECOMMENDED: merge locally (Option 1)
```

Blocking conditions (hard stops — not just advisory):
- `head_commit` doesn't match HEAD → "verification state is stale — re-run /verify"
- `tier` is below minimum for chosen path → "insufficient tier — run /verify --tier package"
- `review_passed` false or missing when `merge-ready` → "review required — run /review"

**Final re-fetch before merge action (TOCTOU fix):**

Between Step 0 (rebase) and the user's final merge approval, `origin/master` can advance.
To close this window, `/finish` performs a second lightweight check immediately before
executing the merge/push:

```bash
# Re-fetch just before final action — check if upstream advanced since Step 0
git fetch origin master --quiet
CURRENT_REMOTE=$(git rev-parse origin/master)
VERIFIED_BASE=$(jq -r '.upstream_base' .vn-squad/verify-state.json)

if [ "$CURRENT_REMOTE" != "$VERIFIED_BASE" ]; then
  echo "origin/master has advanced since verification — re-run /finish to rebase and re-verify"
  exit 1
fi
```

This binds approval to the exact upstream SHA used at verify time. If upstream advanced,
the user is told to re-run `/finish` — which re-does Step 0 rebase and invalidates the
stale verify state, requiring re-verification. No silent stale merges.

The user still approves the final action. The PolicyEngine removes ambiguity by reading
durable state — not session memory — and blocks unsound paths, including late upstream drift.

---

## Key Tradeoffs

### T1: Dual-signal classification adds Tech Lead reasoning overhead
The Tech Lead must check external signals (git diff, exit codes) AND read the advisory
`AGENT_RESULT` block. This is more work per dispatch than pure self-report routing.
**Mitigation:** External signals are cheap to check (one `git diff --stat` call). The
cost is low; the benefit (no self-report suppression of failures) is high.

### T2: verify-state.json invalidated by rebase is the correct behavior
After Step 0 rebase, HEAD changes → verify-state is stale → `/finish` blocks and requires
re-verify. This feels like friction but is correct: the rebased tree has never been tested.
**Decision: embrace this behavior — it is the safety guarantee, not a bug.**

### T3: Atomic write is sufficient — concurrent verify is structurally impossible
VN-Squad's Tech Lead operates within Claude Code's sequential conversation loop. Only one
tool call executes at a time. Two concurrent `/verify` runs cannot occur in the same
session. The `mktemp` + `mv` pattern provides atomicity against crashes and partial writes,
which are the real failure modes here. `run_id` serves as an audit field, not a
concurrency lock. No additional locking is needed for VN-Squad's single-writer architecture.
**Decision: temp-rename is sufficient. Concurrency is a non-issue in this system.**

### T4: GreenContract tier enforcement prevents tier-skipping
`/finish` validates minimum tiers from the state file. The Tech Lead cannot skip
`package` green before a local merge regardless of which `--tier` was run.
**This is the intended behavior — enforcement is the whole point of the gate.**

### T5: Lane status files rejected — visibility blind spots remain
Without per-lane status files, there is no mid-dispatch visibility for stuck agents.
**Mitigation:** Dual-signal post-dispatch classification (Feature 1) surfaces outcomes.
Add a max-wait note to `/dispatch` for manual investigation of long-running agents.

---

## Open Questions

1. Should the `EmptyDiff` auto-recovery (no approval required) be gated on `files_changed: 0`
   from the `AGENT_RESULT` block, or only on the `git diff --stat` external signal? Using
   only git diff avoids the self-report trust issue but requires the Tech Lead to run a
   shell command for every dispatch. **Current design: git diff (external signal only).**

2. Should `verify-state.json` be committed or untracked? Committed = reviewers see what ran.
   Untracked = no git noise. **Current design: untracked (`.vn-squad/` in `.gitignore`).**
   Risk: untracked state is wiped by `git clean -fd`. Add `.vn-squad/` to `.gitignore` only,
   not to any clean command in `/finish`.

3. What happens when `/finish` is run in a repo with no remote (offline, local-only)?
   `git fetch origin master` fails. **Current design: skip Step 0 if `origin` does not exist
   and proceed with local-only branch detection.** Is this safe enough for the VN-Squad
   local-dev use case?
