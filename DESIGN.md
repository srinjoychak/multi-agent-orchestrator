# DESIGN.md — VN-Squad v3: Self-Improving Multi-Vendor Orchestration

## Problem Statement

VN-Squad v2 is a multi-vendor AI orchestration system (Claude Tech Lead + Gemini-worker +
Codex-worker + vn-reviewer) that coordinates via skills (/argue, /dispatch, /plan, /verify,
/finish, /review). It has no feedback loops: agents start cold every session, routing is
static, and hard-won operational knowledge exists only as manually-written memory files.

The v3 challenge: add meaningful self-improvement without violating the properties that make
v2 trustworthy — tiered trust verification, protected files, human-in-the-loop for
unverifiable failures, worktree isolation, lightweight auditable tooling (no daemons).

---

## Proposed Approach: Option A — Minimal Evolutionary Layer (Round 3 Revision)

### Scope

Option A is the correct choice for **single-developer WSL2/local deployments**. Teams on
Linux/macOS with dedicated infrastructure should evaluate Option B (microservice) at v3.1.
This document scopes v3 to the dominant use case; it does not reject Option B paradigmatically.

---

## Revised Design Decisions (Addressing Codex Round 2 Findings)

### F1 (CRITICAL): Plateau measurement was not falsifiable

**REVISE — Define terms precisely.**

**`task_type` is a fixed enum** (defined in the registry schema):
```
code | test | research | docs | debug | refactor | review
```

**`routing override`** (precise definition):
> A routing override is recorded when: (1) the specialization-profile recommends an agent
> different from the AGENTS.md static table for a given task_type, (2) the Tech Lead accepts
> that recommendation, AND (3) the subsequent dispatch outcome is `success`.

Failures after an accepted recommendation do NOT count — they are recorded as false-positives
(see `routing_overrides_that_worsened_outcome` in the profile).

**Plateau milestone (now falsifiable):**
> Option A is delivering meaningful self-improvement when **>= 3 entries appear in
> `decisions.json` of type `routing_override_accepted` with distinct `task_type` values
> from the enum above, AND each has `outcome == success`** — within the first 50 dispatch
> cycles.

This is mechanically verifiable: count distinct accepted routing overrides by task_type in
`decisions.json`. If not reached by cycle 50, the Tech Lead evaluates whether dispatch
volume or task-type diversity is the limiting factor.

**Midpoint check:** At cycle 25, Tech Lead reviews `decisions.json` for routing-override
count. If 0 overrides at cycle 25 despite >= 25 dispatches, the profile data is
accumulating but not triggering suggestions — likely because `sample_size` threshold hasn't
been met. This is an expected state, not a failure.

---

### F2 (CRITICAL): CONTEXT_PROPOSAL approval path — bottleneck and information loss

**REVISE — Add SLA, rejection audit, and proposal expiry.**

**Proposal handling protocol:**

```
CONTEXT_PROPOSAL block in AGENT_RESULT
  │
  ├── Added to session-context.json as status: pending
  │
  ├── Tech Lead reviews pending proposals at the post-dispatch step
  │   (same step as Tier 1 classification — already in the workflow)
  │
  ├── If ACCEPTED:
  │   ├── Merge key-value into session-context.json
  │   └── Log to decisions.json: { type: proposal_accepted, key, agent, rationale }
  │
  └── If REJECTED:
      ├── Move to decisions.json: { type: proposal_rejected, key, agent, reason: "<tech lead note>" }
      └── Removed from session-context.json (not silently dropped — audit exists)
```

**High-frequency safeguards:**
- **Max 3 pending proposals per session.** A 4th proposal from an agent while 3 are pending
  is silently queued (not dropped) in the agent's AGENT_RESULT under `deferred_proposals`.
  Deferred proposals are presented to the Tech Lead in the next session.
- **Proposal expiry:** A pending proposal not reviewed within 2 dispatch cycles auto-expires
  into decisions.json with `type: proposal_expired`. The agent can re-propose on the next
  occurrence.
- **Repeat proposal detection:** Before accepting a proposal, the Tech Lead checks
  decisions.json for prior rejections of the same key by the same agent. If rejected >= 2
  times, a warning is surfaced: "This key was previously rejected N times. Confirm?"

**Collision handling:** If two agents in the same dispatch propose conflicting values for
the same key, both are presented side-by-side as a single decision unit. The Tech Lead
chooses one, merges them manually, or rejects both. One atomic entry in decisions.json.

---

### F3 (CRITICAL): Registry lazy migration — concurrent session safety

**REVISE — Use temp-file-plus-rename (same pattern as verify-state.json).**

**Archive migration protocol (safe under concurrent sessions):**

```bash
# Check if migration needed (oldest entry > 6 months)
OLDEST=$(jq -r '.entries | min_by(.timestamp) | .timestamp' .vn-squad/skill-registry.json)
if [[ "$OLDEST" < "$(date -d '-6 months' -Is)" ]]; then
  # Extract entries to archive
  PERIOD=$(date -d "$OLDEST" +"%Y-H%m" | awk '{if($2>6) print $1"-H2"; else print $1"-H1"}')
  ARCHIVE=".vn-squad/skill-registry-archive/${PERIOD}.json"

  if [[ ! -f "$ARCHIVE" ]]; then
    # Atomic write: temp-file + rename (same as verify-state.json)
    TMPFILE=$(mktemp .vn-squad/skill-registry-archive/migrate.XXXXXX)
    jq '{schema_version:1, entries: [.entries[] | select(.timestamp < "CUTOFF")]}' \
      .vn-squad/skill-registry.json > "$TMPFILE"
    mv "$TMPFILE" "$ARCHIVE"
  fi
  # Remove migrated entries from active registry (also atomic)
  TMPFILE2=$(mktemp .vn-squad/skill-registry.XXXXXX)
  jq '{schema_version:.schema_version, entries: [.entries[] | select(.timestamp >= "CUTOFF")]}' \
    .vn-squad/skill-registry.json > "$TMPFILE2"
  mv "$TMPFILE2" .vn-squad/skill-registry.json
fi
```

**Safety guarantee:** `mv` (rename) is atomic on POSIX filesystems including WSL2. If two
sessions race to migrate, the first `mv "$ARCHIVE"` wins; the second finds the archive
already exists and skips the migration (guard: `if [[ ! -f "$ARCHIVE" ]]`). No data is
lost; the active registry retains the entries until the winner completes its atomic strip.
No locking daemon required — the POSIX rename primitive is sufficient.

---

### F4 (CRITICAL): Specialization-profile TOCTOU — stale snapshot without timestamp

**REVISE — Add freshness tracking and staleness flag.**

**Extended specialization-profile schema:**

```json
{
  "agent": "gemini-worker",
  "last_recomputed_at": "iso8601",
  "registry_entry_count_at_recompute": 47,
  "strengths": [...],
  "weaknesses": [...],
  "constraints": [...],
  "staleness_warning": false
}
```

**Recomputation trigger (session start):**

1. Read `registry_entry_count_at_recompute` from profile.
2. Count current entries in `skill-registry.json`.
3. If `current_count > profile_count_at_recompute`: recompute profile from registry.
4. If unchanged: use cached profile (fast path).

**Staleness flag:** If the profile's `last_recomputed_at` is > 30 minutes old AND current
registry count exceeds profile count by >= 5 entries, set `staleness_warning: true`. The
Tech Lead sees this flag before making routing decisions and can force recomputation.

**Concurrency behavior:** Two sessions reading a stale profile and making routing decisions
independently is acceptable — routing decisions are recommendations, not automated actions.
The human approves routing. Stale-profile routing suggestions may be suboptimal but are
not dangerous. This is consistent with the design's human-in-the-loop principle.

---

### F5 (MAJOR): Recovery trajectory filter excludes its highest-signal data point

**REVISE — 3rd+ occurrence is `pattern-confirmed`, not noise.**

**Revised trajectory capture policy:**

| Trajectory type | Capture? | Prefix | Rationale |
|---|---|---|---|
| 1st failure, no recovery | No | — | Incomplete signal |
| 1st failure + recovery → success | Yes | `recovery-` | First confirmed recovery path |
| 2nd occurrence, same failure_code + task_type, recovery → success | Yes | `recovery-` | Confirms pattern |
| 3rd+ occurrence, same failure_code + task_type, recovery → success | Yes | `pattern-confirmed-` | **Highest signal** — statistically confirmed |
| Same failure_code + task_type, recovery → failure | No | — | Unresolved; defer |
| Success + APPROVE verdict | Yes | `success-` | Canonical happy path |
| Success + REQUEST_CHANGES | No | — | Borderline quality |
| Duplicate success, same (agent, task_type, prompt_hash) | No | — | Deduplicated |

**Pattern-confirmed trajectories** are promoted in routing: when the specialization-profile
processes registry entries, pattern-confirmed trajectories carry 3x weight vs. single
recovery trajectories in calculating recovery success rates.

---

### F6 (MAJOR): Prompt-patch "validated_successes" undefined; expiry not task-type-aware

**REVISE — Precise definition and task-type-scoped expiry.**

**`validated_success` (precise definition):**
> A dispatch is a validated success for patch P if: (1) patch P was active (merged into
> the agent's prompt), (2) the dispatch's `agent` and `task_type` match P's `target_agent`
> and `target_task_types[]`, AND (3) the dispatch outcome is `success` with
> `review_verdict == APPROVE`.

**Task-type-scoped expiry:**

```json
{
  "id": "uuid",
  "agent": "gemini-worker",
  "target_task_types": ["code", "refactor"],
  "category": "constraints",
  "constraint": "Embed full file contents inline.",
  "rationale": "EmptyDiff pattern on code tasks: 5 occurrences",
  "added": "iso8601",
  "status": "active",
  "samples_seen": 0,
  "validated_successes": 0,
  "expiry_rule": "expire if validated_successes == 0 after 10 samples_seen matching (agent, target_task_types)"
}
```

**Expiry:** Increment `samples_seen` only for dispatches matching `(target_agent, target_task_types)`.
Expire when `samples_seen >= 10 AND validated_successes == 0`. This makes the expiry
task-type-scoped, not total-dispatch-count-scoped.

**Max active patches (frequency-aware calibration):**
The 20-patch limit is replaced with: **max 5 active patches per (agent × category)**
combination. At 10/day frequency, 5 patches per category per agent allows meaningful
diversity without incoherence. Category-scoped limits are more principled than a global cap.

---

### F7 (MAJOR): Category conflict resolution — mechanism undefined

**REVISE — Block with explicit state; enforce resolution before dispatch.**

**Conflict state machine for prompt-patches:**

```
NEW PATCH proposed
  │
  ├── Category + agent combination has 0-4 existing patches → ACCEPTED (status: active)
  │
  └── Category + agent combination already has 5 active patches:
      ├── Identify lowest-validated patch in same category (fewest validated_successes)
      ├── Surface conflict to Tech Lead:
      │   "New patch conflicts with existing low-value patch P (N validated_successes).
      │    Options: (a) replace P with new patch, (b) reject new patch, (c) merge into P"
      └── New patch stays status: pending-conflict until Tech Lead resolves
          → Pending-conflict patches are NOT merged into dispatches
```

**No dispatch proceeds with unresolved conflicts** for the affected (agent, category)
combination. The Tech Lead must resolve before the next dispatch to that agent on that
task type. This is enforced by the `/dispatch` skill checking `prompt-patches.json` for
any `status: pending-conflict` entries matching the target agent.

---

### F8 (MAJOR): Recovery trajectory mechanism — "no recovery attempted" not mechanized

**REVISE — Detection via `session-context.json` dispatch history.**

**Mechanized recovery detection:**

The `/dispatch` skill appends each completed task to `session-context.json`:
```json
"completed_tasks": [
  { "id": "task-uuid", "agent": "gemini-worker", "outcome": "EmptyDiff",
    "task_type": "code", "timestamp": "iso8601", "recovery_ref": null }
]
```

A recovery dispatch is detected when a new task's prompt references a prior failed task
(Tech Lead includes a "Retry after failure of task-uuid" annotation). The `/dispatch` skill
sets `recovery_ref: "prior-task-uuid"` on the new task entry.

At session end, any completed task with `outcome == failure` AND no subsequent task entry
with `recovery_ref` pointing to it is classified as `no_recovery_attempted`. This is fully
mechanized: scan `completed_tasks` in `session-context.json` for failure entries with no
matching recovery reference.

**Recovery chain termination:** A recovery chain terminates when a task with
`recovery_ref != null` has `outcome == success`. The chain is: `[original, ...retries]`
where the final entry is the first success.

---

### F9 (MAJOR): Registry archive query policy — vague, inconsistency risk

**REVISE — Archive query is always explicit, never automatic.**

**Archive query policy (final):**

- **Default query path:** Active `skill-registry.json` only. The specialization-profile
  is the pre-aggregated read optimization and is the primary source for routing decisions.
- **Archive query:** Only accessible via explicit Tech Lead invocation:
  ```
  /plan --include-archive   (queries active + most recent archive file)
  /plan --archive-since 2025-01   (queries specific archive period)
  ```
  Archive query results are clearly labeled `[historical data: >6 months]` in the output.
- **No automatic fallback:** If active registry has < 3 samples for a task type, the
  system surfaces this as a data gap ("Insufficient data for gemini-worker on task_type:code
  — n=2. Recommend defaulting to AGENTS.md static table."). It does NOT silently query
  the archive.
- **Consistency guarantee:** All routing decisions in a session use either active-only or
  active+explicit-archive. Mixing is not allowed within a session.

---

## Additional Gaps Addressed (Codex Round 2 New Findings)

### G1: Failure-code standardization

**ADOPT.** `failure_code` is a closed enum defined in the registry schema (from DESIGN.md v2):

```
EmptyDiff | CompileRed | TestFail | StaleBranch | PromptMisdelivery | ProviderFailure | none
```

Agents may NOT invent new failure codes. Unknown codes are normalized to `none` by the
registry write step. Trajectory deduplication uses this enum — not free-text matching.

### G2: Dispatch-context lineage

**ADOPT.** Registry entries include dispatch context:

```json
{
  "id": "uuid",
  "timestamp": "iso8601",
  "branch": "feature/auth-refactor",
  "head_commit": "abc123",
  ...existing fields...
}
```

This allows routing variation analysis to control for branch/codebase state.

### G3: Human-decision audit log

**ADOPT.** `decisions.json` (`.vn-squad/decisions.json`) captures all Tech Lead decisions:

```json
{
  "schema_version": 1,
  "entries": [{
    "id": "uuid",
    "timestamp": "iso8601",
    "type": "routing_override_accepted | routing_override_rejected | proposal_accepted | proposal_rejected | proposal_expired | patch_added | patch_graduated | patch_expired",
    "agent": "gemini-worker",
    "task_type": "code",
    "reason": "<tech lead note>",
    "dispatch_ref": "skill-registry-entry-uuid",
    "outcome_ref": null
  }]
}
```

`outcome_ref` is filled in post-dispatch with the registry entry UUID for the subsequent
dispatch. This enables meta-learning: filter decisions by type `routing_override_accepted`
and join to `outcome_ref` entry to measure override quality.

### G4: Corruption recovery

**ADOPT (minimal).** On each `skill-registry.json` read, validate `schema_version` field.
If missing or malformed:
1. Rename to `skill-registry.bak.json` (preserve for manual recovery)
2. Initialize a fresh `skill-registry.json` with `schema_version: 1` and empty `entries`
3. Log a warning to `decisions.json`: `{ type: registry_corrupted, reason: "schema_version invalid" }`

Specialization-profiles are fully recomputable from the registry, so profile corruption is
recovered by deletion + recomputation. Archive files are immutable after migration; no
recovery mechanism needed (rename approach).

---

## The Persistence Layer: `.vn-squad/` Final Schema

```
.vn-squad/
├── verify-state.json            ← v2 (unchanged)
├── skill-registry.json          ← append-log of all dispatch outcomes
├── skill-registry-archive/      ← time-rotated (>6 months), POSIX-atomic migration
│   └── 2025-H2.json
├── session-context.json         ← inter-agent knowledge (pending proposals + accepted context)
├── decisions.json               ← all Tech Lead decisions (routing, proposals, patches)
├── skill-manifest.json          ← dynamic skill discovery index (quick win)
├── trajectories/
│   ├── success-<uuid>.json      ← canonical happy paths (APPROVE verdict)
│   ├── recovery-<uuid>.json     ← confirmed recovery chains
│   └── pattern-confirmed-<uuid>.json  ← 3rd+ confirmed recovery (highest signal)
├── skills/
│   └── <task-type>-<hash>.json  ← reusable solution snapshots (AgentFactory)
├── prompt-patches.json          ← bounded, lifecycle-managed, conflict-checked patches
└── specialization-profile/      ← per-agent pre-aggregated routing summaries
    ├── gemini-worker.json       ← includes last_recomputed_at, staleness_warning
    └── codex-worker.json
```

---

## The Self-Improvement Loop (Final)

```
Session start
  │
  ├── [1] Read specialization-profile/ (check staleness via registry_entry_count diff)
  │   → Recompute if registry has new entries since last_recomputed_at
  │   → Flag staleness_warning if > 30 min old AND > 5 new entries
  │
  ├── [2] Lazy archive migration (POSIX atomic: mv, guard: archive already exists check)
  │
  ├── [3] Tech Lead reads profiles → calibrate routing:
  │   n >= 3 (preliminary) | n >= 10 (stable) | worsened/accepted > 0.3 → recalibrate flag
  │   Check decisions.json plateau milestone: >= 3 distinct task_type routing overrides accepted
  │
  ├── [4] Tech Lead writes/seeds session-context.json (reset per session, seed from last trajectory)
  │
  ├── [5] Check prompt-patches.json for pending-conflict entries for target agents → resolve before dispatch
  │
  ├── [6] /dispatch → agents execute in isolated worktrees
  │   - Agents receive session-context.json "Prior context" block
  │   - Agents may emit CONTEXT_PROPOSAL: in AGENT_RESULT
  │
  ├── [7] Post-dispatch (existing Tier 1/2/3 classification — unchanged)
  │
  ├── [8] Post-dispatch (NEW v3 additions):
  │   ├── Review CONTEXT_PROPOSAL blocks (max 3 pending):
  │   │   → Accept: merge to session-context.json + log to decisions.json
  │   │   → Reject: log to decisions.json with reason (never silently dropped)
  │   ├── Append outcome to skill-registry.json (with branch + head_commit lineage)
  │   ├── Tag recovery_ref if this was a recovery dispatch
  │   ├── Classify trajectory: success | recovery | pattern-confirmed | skip
  │   ├── Update dispatch_count + validated_successes for active prompt-patches
  │   ├── Check patch expiry (samples_seen >= 10 for target types, 0 successes → expire)
  │   └── Check patch graduation (validated_successes >= 5 → flag for AGENTS.md promotion)
  │
  └── [9] Session end:
      ├── Scan completed_tasks for no_recovery_attempted failures → classify in registry
      ├── Update specialization-profile/ from registry delta
      └── Check decisions.json plateau milestone progress
```

---

## Open Questions (Final — Narrowed to 2)

1. **Cross-vendor skill transfer:** When `skills/<hash>.json` captures a solution, can it
   be offered to a different vendor on a similar task? Requires task similarity scoring
   (structured task_type + tags vs. semantic embedding). Proposal: defer to v3.1; v3 tags
   skills with `task_type` enum only, enabling exact-match retrieval as a first step.

2. **Improvement validation for patch graduation:** A patch with >= 5 validated successes
   is flagged for Tech Lead promotion to AGENTS.md. But the Tech Lead may forget to act on
   the flag. Proposal: the `decisions.json` flag persists and is surfaced at the next session
   start alongside routing calibration. It does not auto-apply; it surfaces until explicitly
   resolved (promoted or rejected with a reason).
