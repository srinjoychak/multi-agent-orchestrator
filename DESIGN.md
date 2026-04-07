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

## Proposed Approach: Option A — Minimal Evolutionary Layer (Round 4 — Final)

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

**`task-level success`** (precise definition — applies throughout this document):
> A dispatch outcome is a **task-level success** when `AGENT_RESULT.status == success` AND
> `AGENT_RESULT.failure_code == none`, verified by the Tier 1 external signal (git diff
> returns > 0 files changed). An `EmptyDiff` classification is a task-level FAILURE even if
> the `/dispatch` skill itself completed without error. Dispatch-level success (skill
> execution) is irrelevant; only task-level success counts.

**`routing override`** (precise definition):
> A routing override is recorded when: (1) the specialization-profile recommends an agent
> different from the AGENTS.md static table for a given task_type, (2) the Tech Lead accepts
> that recommendation, AND (3) the subsequent dispatch results in a **task-level success**.

Failures after an accepted recommendation do NOT count — they are recorded as false-positives
(see `routing_overrides_that_worsened_outcome` in the profile). Recovery chains: if an
accepted override fails but a recovery succeeds, the override is counted as a false-positive
(the original routing recommendation failed). The recovery is a separate event.

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
- **Proposal expiry:** A pending proposal expires if 2 subsequent `/dispatch` skill
  invocations complete within the same session without the proposal being reviewed.
  "Dispatch cycle" = one `/dispatch` skill invocation (not a session). Sessions with zero
  dispatches do not advance the expiry counter. Expired proposals are moved to decisions.json
  with `type: proposal_expired`; the agent can re-propose on the next occurrence.
- **Repeat proposal detection:** Before accepting a proposal, the Tech Lead checks
  decisions.json for prior rejections of the same key by the same agent. If rejected >= 2
  times, a warning is surfaced: "This key was previously rejected N times. Confirm?"

**Collision handling:** If two agents in the same dispatch propose conflicting values for
the same key, both are presented side-by-side as a single decision unit. The Tech Lead
chooses one, merges them manually, or rejects both. One atomic entry in decisions.json.

**Agent visibility of rejections:** Rejected proposal keys are appended to
`session-context.json` under `rejected_keys: [{ key, reason, agent, timestamp }]`. On the
next dispatch, agents receive this list in their "Prior context" block. This prevents
agents from re-proposing a key that was explicitly rejected without a reason signal.

---

### F3 (CRITICAL): Registry lazy migration — concurrent session safety

**REVISE — Use temp-file-plus-rename (same pattern as verify-state.json).**

**Archive migration protocol (TOCTOU-safe — no guard check before mv):**

The prior design had a TOCTOU race: `if [[ ! -f "$ARCHIVE" ]]; then mv ...fi` — two
sessions could both pass the guard before either completes the mv. The fix: **always compute
the archive in a temp file, then use `mv --no-clobber`** (fails if target exists). Archive
content is deterministic (entries older than 6 months, same source data), so both sessions
produce identical output; whichever mv wins is correct.

```bash
OLDEST=$(jq -r '.entries | min_by(.timestamp) | .timestamp' .vn-squad/skill-registry.json)
if [[ "$OLDEST" < "$(date -d '-6 months' -Is)" ]]; then
  PERIOD=$(date -d "$OLDEST" +"%Y-%m" | awk -F'-' '{if($2>6) print $1"-H2"; else print $1"-H1"}')
  ARCHIVE=".vn-squad/skill-registry-archive/${PERIOD}.json"

  # Always write to temp (no guard check — eliminates TOCTOU window)
  TMPFILE=$(mktemp .vn-squad/skill-registry-archive/migrate.XXXXXX)
  CUTOFF=$(date -d '-6 months' -Is)
  jq --arg c "$CUTOFF" '{schema_version:1, entries:[.entries[]|select(.timestamp < $c)]}' \
    .vn-squad/skill-registry.json > "$TMPFILE"

  # --no-clobber: atomic, fails silently if archive already exists (concurrent session won the race)
  mv --no-clobber "$TMPFILE" "$ARCHIVE" || rm -f "$TMPFILE"

  # Remove migrated entries from active registry (atomic rename)
  TMPFILE2=$(mktemp .vn-squad/skill-registry.XXXXXX)
  jq --arg c "$CUTOFF" '{schema_version:.schema_version, entries:[.entries[]|select(.timestamp >= $c)]}' \
    .vn-squad/skill-registry.json > "$TMPFILE2"
  mv "$TMPFILE2" .vn-squad/skill-registry.json
fi
```

**Safety guarantee:** No TOCTOU window — the guard check is eliminated. Both sessions
compute identical archive content (deterministic from same source data). `mv --no-clobber`
is atomic: one session wins, the other's temp file is cleaned up. The strip of active
registry entries is atomic via rename. No locking daemon required.

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

**Recomputation trigger (session start — FORCED, not optional):**

1. Read `registry_entry_count_at_recompute` from profile.
2. Count current entries in `skill-registry.json`.
3. If `current_count > profile_count_at_recompute` OR `last_recomputed_at > 30 min ago`
   AND entry delta >= 5: **automatically recompute profile** before routing decisions are
   presented. Recomputation is not optional — stale profiles are not used for routing.
4. If unchanged: use cached profile (fast path — no I/O beyond entry count check).

**Staleness = forced recompute, not a warning.** The prior design surfaced `staleness_warning`
for the Tech Lead to act on. This was insufficient (Codex finding: no enforcement). The
corrected behavior: staleness triggers automatic background recomputation at session start,
completed before the routing calibration step. The Tech Lead always sees a fresh profile.

**Concurrency behavior:** Two concurrent sessions recomputing from the same registry produce
identical profiles (deterministic from same source). The second session's recompute
overwrites the first's output atomically (temp-file + rename). This is safe and correct.

**Specialization-profile computation algorithm:**

```
For each agent in {gemini-worker, codex-worker, claude-subagent}:
  For each task_type in {code, test, research, docs, debug, refactor, review}:
    entries = registry entries where agent == A AND task_type == T

    raw_successes    = count(entries where failure_code == none AND review_verdict == APPROVE)
    recovery_count   = count(trajectories/recovery-*.json where agent == A AND task_type == T)
    pattern_weight   = count(trajectories/pattern-confirmed-*.json where agent == A AND task_type == T) × 3
    total_samples    = count(entries)
    
    weighted_success_rate = (raw_successes + recovery_count + pattern_weight)
                            / max(1, total_samples + pattern_weight)

    if total_samples >= 10:   profile.strengths or .weaknesses (stable)
    elif total_samples >= 3:  preliminary (labeled)
    else:                     insufficient_data (silent — use AGENTS.md static table)

  failure_mode_map = { failure_code: count } for all entries where failure_code != none
  constraints = current active prompt-patches for this agent (status: active)
```

**Routing decision algorithm (decision tree):**

```
Given task_type T and candidate agents from AGENTS.md static table:

1. Load specialization-profile for each candidate agent A.

2. For agent A on task_type T:
   - If insufficient_data: use AGENTS.md weight (no override)
   - If preliminary (n=3-9):
       If weighted_success_rate < 0.5:
         → Surface preliminary recommendation: "Preliminary — consider [other agent]"
         → AGENTS.md agent remains default; Tech Lead chooses
   - If stable (n >= 10):
       If weighted_success_rate < 0.5 AND alternative agent has weighted_success_rate >= 0.7:
         → Surface stable recommendation: "Route to [better agent] (n=N, rate=R)"
         → Record in decisions.json as routing_override_suggested
         → Tech Lead accepts → routing_override_accepted (counts toward plateau milestone)
         → Tech Lead rejects → routing_override_rejected (false-positive tracking continues)

3. Recalibration trigger:
   If routing_overrides_that_worsened_outcome / routing_overrides_accepted > 0.3:
     → Flag in profile: "Threshold may be miscalibrated — review decisions.json"
     → No automatic threshold change; Tech Lead adjusts via prompt-patches.json routing_config
```

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

**Pattern-confirmed trajectories** are promoted in routing via the weighted success rate
formula in the profile computation algorithm (see F4 section). Each pattern-confirmed
trajectory contributes a weight of 3 to both numerator and denominator:

```
weighted_success_rate = (raw_successes + recovery_count + pattern_confirmed_count × 3)
                        / max(1, total_samples + pattern_confirmed_count × 3)
```

**Pattern scope:** A pattern is keyed on the tuple `(failure_code × task_type)`. EmptyDiff
on task_type=code and EmptyDiff on task_type=test are **distinct patterns** — they have
separate counts and generate separate pattern-confirmed trajectories.

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

**Conflict resolution is logged to decisions.json** with type `patch_conflict_resolved`:
```json
{ "type": "patch_conflict_resolved", "winning_patch_id": "uuid", "retired_patch_id": "uuid",
  "resolution": "replace | merge | reject_new", "reason": "<tech lead note>" }
```

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
    "type": "routing_override_suggested | routing_override_accepted | routing_override_rejected | proposal_accepted | proposal_rejected | proposal_expired | patch_added | patch_conflict_resolved | patch_graduated | patch_expired | registry_corrupted",
    "agent": "gemini-worker",
    "task_type": "code",
    "reason": "<tech lead note>",
    "dispatch_ref": "skill-registry-entry-uuid",
    "outcome_ref": null,
    "recovery_chain_final_ref": null
  }]
}
```

**`outcome_ref` semantics (clarified):** Points to the registry entry UUID for the
**immediate next dispatch** following the routing decision. If that dispatch fails and a
recovery occurs, `outcome_ref` still points to the original (failing) entry — this is
intentional. The recovery is a separate, independent event.

**`recovery_chain_final_ref`:** If a recovery chain follows the original dispatch,
`recovery_chain_final_ref` is filled in with the registry UUID of the **final successful
outcome** in the recovery chain. This allows two modes of meta-learning:
- `outcome_ref` = "did the override immediately succeed?" (strict)
- `recovery_chain_final_ref` = "did the override eventually succeed with recovery?" (lenient)

Both fields are null until post-dispatch classification completes.

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

2. **Patch graduation workflow (resolved):** When a patch reaches >= 5 validated_successes:
   - Its `status` field changes to `graduated` in `prompt-patches.json`
   - A `patch_graduated` entry is added to `decisions.json` with the patch text
   - At next session start, Tech Lead is presented: "Patch [ID] has 5 validated successes
     and is ready for promotion to AGENTS.md. Options: (a) promote — manually edit AGENTS.md
     and confirm, (b) reject — add reason to decisions.json, patch reverts to active"
   - If promoted: Tech Lead manually edits AGENTS.md (protected file — requires explicit
     human action), then adds `decisions.json` entry `{ type: patch_graduated, promoted_to: "AGENTS.md", constraint: "..." }`
   - The graduated patch is removed from `prompt-patches.json` active list (no longer
     merged at dispatch time — the constraint now lives permanently in AGENTS.md)
   - If the flag persists unresolved across > 3 sessions, it is re-surfaced with escalating
     prominence. It is never auto-applied.
