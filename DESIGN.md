# DESIGN.md — VN-Squad v3: Self-Improving Multi-Vendor Orchestration

## Problem Statement

VN-Squad v2 is a multi-vendor AI orchestration system (Claude Tech Lead + Gemini-worker +
Codex-worker + vn-reviewer) that coordinates via skills (/argue, /dispatch, /plan, /verify,
/finish, /review). It produces quality output through cross-vendor collaboration but has no
feedback loops: agents start cold every session, routing is static, and hard-won knowledge
(e.g., Gemini's 6 documented failure modes) exists only as manually-written memory files
that a new session may never read.

The v3 challenge is: add meaningful self-improvement without violating the properties that
make v2 trustworthy — tiered trust verification, protected files, human-in-the-loop for
unverifiable failures, worktree isolation, lightweight auditable tooling (no daemons).

---

## Proposed Approach: Option A — Minimal Evolutionary Layer (Revised)

### Architecture Decision

**Adopt Option A (persistence layer on v2) as the v3 foundation** for single-developer
local deployments (including WSL2). Borrow architectural *patterns* from Option B (AgentScope)
and Option C (DSPy) without adopting their *infrastructure requirements* (daemons, message
brokers, databases, Python runtimes).

**Scope clarification (Codex finding F7 — REVISE):** Option A is the right choice for
single-developer WSL2 deployments where background daemons do not survive Windows restarts
and ops burden must be zero. Teams running VN-Squad on Linux/macOS with dedicated
infrastructure should revisit Option B at v3.1. This document scopes v3 to the dominant
use case.

**Core rationale (unchanged):** The bottleneck in v2 is not infrastructure — it is feedback
loops. Every dispatch already produces all signal needed for self-improvement. Closing the
feedback loop requires only persistent writes to `.vn-squad/`, not a new runtime.

---

## The Persistence Layer: `.vn-squad/` Extension

All new v3 state lives in `.vn-squad/` (untracked, like `verify-state.json`). Plain JSON.
No new dependencies.

```
.vn-squad/
├── verify-state.json            ← v2 (already exists)
├── skill-registry.json          ← NEW: every dispatch outcome (foundation)
├── skill-registry-archive/      ← NEW: time-rotated registry entries (>12 months)
│   └── 2025.json
├── session-context.json         ← NEW: inter-agent knowledge (Tech Lead writes + approves)
├── skill-manifest.json          ← NEW: dynamic skill discovery (quick win)
├── trajectories/                ← NEW: success + failure-recovery chains (SE-Agent pattern)
│   ├── success-<uuid>.json
│   └── recovery-<uuid>.json
├── skills/                      ← NEW: reusable solution snapshots (AgentFactory)
│   └── <task-type>-<hash>.json
├── prompt-patches.json          ← NEW: safe prompt evolution (bounded, conflict-checked)
└── specialization-profile/      ← NEW: per-agent empirical performance
    ├── gemini-worker.json
    └── codex-worker.json
```

---

## Revised Design Decisions (Addressing Codex Round 1 Findings)

### Finding F1 (CRITICAL): Option A plateau is unfalsifiable

**REVISE.** The "50+ cycles" claim needed a falsifiable measurement framework.

**Plateau measurement milestone:** Option A is considered delivering meaningful self-improvement
when **routing recommendations based on registry data override the static AGENTS.md table
on >= 3 distinct task types within the first 50 dispatch cycles**. If this milestone is
not reached by cycle 50, the accumulated data is insufficient — either dispatch volume is
too low or task types are not diverse enough — and the Tech Lead should evaluate whether
the system warrants a re-architecture review (Option B/C).

Measurement is automatic: `specialization-profile/<agent>.json` records when a routing
recommendation was generated and whether it was accepted. The Tech Lead checks this at
cycle 25 as a midpoint review.

---

### Finding F2 (CRITICAL): session-context.json read-only is too restrictive

**REVISE.** The read-only constraint creates a real bottleneck: if Gemini discovers a
recovery strategy mid-session, that knowledge is lost to Codex unless the Tech Lead
manually extracts and updates it. This defeats the stated purpose of inter-agent learning.

**Revised mechanism — Context Proposals (human-approved write path):**

Agents may emit a `CONTEXT_PROPOSAL:` block at the end of their AGENT_RESULT:

```
CONTEXT_PROPOSAL:
  key: conventions.json_output_required
  value: true
  rationale: "Task required JSON output; flag prevented malformed response"
```

The Tech Lead reviews proposals after each dispatch (alongside the existing Tier 1
classification step) and either:
- **Accepts:** Merges the key-value into `session-context.json`
- **Rejects:** Ignores (proposal is not stored)

This preserves the self-report trust constraint (agents cannot unilaterally write shared
state) while enabling genuine inter-agent learning. The write path remains exclusively
through Tech Lead review — consistent with the human-approval pattern used for prompt
patches and routing overrides.

---

### Finding F3 (MAJOR): sample_size >= 10 threshold uncalibrated

**REVISE.** Start at `sample_size >= 3` for generating routing *suggestions*. Below 3, the
system is silent. At 3-9, suggestions are labeled `(preliminary — n=N)` and carry a
warning. At >= 10, suggestions are labeled `(stable — n=N)`.

**Auto-threshold adjustment mechanism:** The `specialization-profile/<agent>.json` tracks
`routing_overrides_accepted` and `routing_overrides_that_worsened_outcome`. After every
10 accepted overrides, the system computes: if `worsened / accepted > 0.3`, the current
effective threshold is too low and the profile logs a recommendation to raise it. The Tech
Lead reviews this recommendation and adjusts the threshold in `prompt-patches.json` under
a `routing_config` section. The system cannot auto-adjust its own threshold — but it can
flag when calibration is needed.

---

### Finding F4 (MAJOR): Trajectory capture APPROVE-only creates survivor bias

**REVISE.** The original filter (APPROVE verdicts only) discards the highest-signal
trajectories: failure-recovery chains.

**Revised trajectory capture policy:**

| Trajectory type | Capture? | Filename prefix | Value |
|---|---|---|---|
| `outcome == success AND review_verdict == APPROVE` | Yes | `success-<uuid>.json` | High-confidence happy path |
| `outcome == failure followed by recovery outcome == success` | Yes | `recovery-<uuid>.json` | Recovery patterns (highest signal) |
| `outcome == failure, same failure_code on same task_type, 3rd+ occurrence` | No | — | Duplicate noise |
| `outcome == failure, no recovery attempted` | No | — | Incomplete signal |
| `outcome == success AND review_verdict == REQUEST_CHANGES` | No | — | Borderline quality, not canonical |

Recovery trajectories include the full chain: original task prompt → failure classification
→ recovery agent → recovery prompt → success outcome. This is the SE-Agent pattern applied
correctly — not just replay of winners, but replay of recovery paths.

---

### Finding F5 (MAJOR): prompt-patches.json has no conflict detection

**REVISE.** Unbounded patch accumulation with no conflict detection is a latency and
coherence liability.

**Bounded patch protocol:**

```json
{
  "schema_version": 1,
  "patches": [{
    "id": "uuid",
    "agent": "gemini-worker",
    "category": "formatting|constraints|tool-flags|context",
    "constraint": "Embed full file contents inline. Never reference files by path only.",
    "rationale": "Gemini EmptyDiff pattern: 5 occurrences",
    "added": "iso8601",
    "dispatch_count": 0,
    "validated_successes": 0,
    "status": "active|graduated|expired"
  }]
}
```

**Lifecycle rules:**
- **Max 20 active patches per agent** — adding a 21st requires retiring an existing one
- **Category conflict:** Two patches in the same category for the same agent must be
  explicitly resolved before the second is added (Tech Lead reviews the conflict)
- **Expiry:** A patch that sees 0 `validated_successes` after 50 dispatches is marked
  `expired` and removed from the merge path
- **Graduation:** A patch with >= 5 `validated_successes` is flagged for graduation:
  Tech Lead may explicitly promote it to a permanent constraint in AGENTS.md (requires
  human approval of the AGENTS.md change — protected file update, fully intentional)
- **At dispatch:** Only `status == active` patches are merged into the agent prompt.
  The merge is additive (appended to the prompt under "Additional constraints") with a
  `[vn-squad patch: <id>]` tag so the Tech Lead can trace which constraint came from where

---

### Finding F6 (MAJOR): Registry size management is arbitrary

**REVISE.** Replace rotation-at-500-entries with **time-bucketed queries**.

**Registry management policy:**
- Active registry (`skill-registry.json`) holds entries for the **last 6 months**
- Entries older than 6 months are moved to `skill-registry-archive/<year>-<half>.json`
  on session start (lazy migration — only if the oldest entry in the active file is > 6
  months old)
- Archive files are never queried by default. The Tech Lead or `/plan` skill queries only
  the active registry
- If a task type has < 3 entries in the active registry, `/plan` may optionally query the
  most recent archive file to supplement — but this is explicit, not automatic
- Archive files are never deleted (audit trail). Storage impact: at 1 dispatch/week,
  6-month window = ~26 entries. At 10/week = ~260 entries. Active file stays small.

**Routing query pattern:** Rather than scanning all entries, `specialization-profile/<agent>.json`
is the pre-aggregated read path. The registry is the write-append log; profiles are the
pre-computed summaries. The profile is regenerated from the active registry at session start
(lazy recompute if registry has new entries since last profile update).

---

## The Self-Improvement Loop (Final)

```
Session start
  │
  ├── Lazy: recompute specialization-profile/ from active skill-registry.json
  ├── Lazy: migrate registry entries > 6 months to archive
  │
  ├── Tech Lead reads profiles → calibrates routing:
  │   - sample_size >= 3: preliminary suggestion (labeled)
  │   - sample_size >= 10: stable suggestion
  │   - worsened/accepted > 0.3: flag threshold recalibration needed
  │
  ├── Tech Lead writes session-context.json (conventions, constraints for this session)
  │
  ├── /dispatch → agents execute in isolated worktrees
  │   - Agents receive session-context.json "Prior context" block in task prompts
  │   - Agents may emit CONTEXT_PROPOSAL: blocks (NOT writes — just proposals)
  │
  ├── Post-dispatch (existing Tier 1/2/3 classification — unchanged)
  │
  ├── Post-dispatch (NEW v3 additions):
  │   ├── Review CONTEXT_PROPOSAL blocks → Tech Lead accept/reject → update session-context.json
  │   ├── Append outcome entry to skill-registry.json
  │   ├── If recovery trajectory: capture to trajectories/recovery-<uuid>.json
  │   ├── If success + APPROVE: capture to trajectories/success-<uuid>.json
  │   ├── If success + novel: snapshot to skills/<task-type>-<hash>.json
  │   └── Update dispatch_count + validated_successes on active prompt-patches
  │
  └── Session end (or periodic):
      ├── Update specialization-profile/ from registry delta
      └── Check: any patches graduated (>= 5 successes)? → flag for AGENTS.md promotion
```

---

## The Five Debate Questions — Final Positions

### Q1: Is Option A sufficient?
Yes, for the defined scope and the plateau milestone is now falsifiable: >= 3 routing
overrides accepted across distinct task types within 50 dispatch cycles.

### Q2: Does Option B violate the lightweight principle?
Yes, for WSL2/single-developer context. Option B is valid for Linux/macOS team deployments.
This is now scoped correctly in the design rather than dismissing Option B paradigmatically.

### Q3: Minimum viable loop for 50 cycles
Three artifacts + revised CONTEXT_PROPOSAL protocol:
1. `skill-registry.json` + time-bucketed archive
2. `session-context.json` with Tech Lead-gated write path (CONTEXT_PROPOSAL)
3. `specialization-profile/<agent>.json` (lazy recomputed from registry)

Plus: `prompt-patches.json` with lifecycle (bounded, conflict-checked, graduation path).

### Q4: Automatic routing vs recommendation requiring approval
Recommendation at sample_size >= 3 (preliminary) and >= 10 (stable). Auto-adjustment of
the threshold itself requires Tech Lead approval (triggered by `worsened/accepted > 0.3`).

### Q5: Where does the improvement loop close?
At the Tech Lead + human approval boundary, always. CONTEXT_PROPOSAL, routing suggestions,
patch graduation, and AGENTS.md promotion all require explicit Tech Lead action. Agents
improve their outputs; the improvement loop for the system itself is human-gated.

---

## Key Tradeoffs

### T1: Option A plateau vs Option B infrastructure
Option A is scoped to WSL2/single-developer. Teams on Linux/macOS should revisit Option B
at v3.1. The `skill-registry.json` schema is designed to be forward-compatible with a
future MoA-style router (it captures all signals a router would need).

### T2: Routing recommendation vs auto-routing
Preliminary at n=3, stable at n=10. Threshold recalibration is human-approved but
system-triggered. Consistent with v2's trust model.

### T3: CONTEXT_PROPOSAL (agent-proposed, Tech Lead-approved writes)
Agents propose; humans approve. Self-report trust problem is preserved as advisory only.
No agent can unilaterally write to shared context.

### T4: prompt-patches.json with lifecycle
Bounded (20 active per agent), conflict-checked (same category requires explicit resolution),
graduated to AGENTS.md with human approval after 5 validated successes.

### T5: Trajectory capture includes failure-recovery chains
Both success and failure-recovery trajectories captured. Duplicate failures (3rd+ same
error) and no-recovery failures excluded (noise, not signal).

### T6: Registry is append-log; profiles are pre-aggregated summaries
Queries go to `specialization-profile/`, not raw registry. Registry is the source of truth;
profiles are the lazy-computed read optimization.

---

## Open Questions (Narrowed)

1. **CONTEXT_PROPOSAL key collision:** If two agents in the same dispatch propose conflicting
   values for the same context key, which takes precedence? Proposal: last-write-wins in
   Tech Lead review order; both proposals are presented side-by-side for decision.

2. **session-context.json session reset:** Reset on every new Claude Code session (seed from
   last successful trajectory's conventions if one exists for the current branch). Stale
   conventions from a prior feature branch must not contaminate a new session.

3. **Cross-vendor skill transfer:** When `skills/<hash>.json` captures a solution pattern,
   can it be offered to a different vendor on a similar task? Requires task similarity
   scoring. Proposal: defer to v3.1; tag skills with structured task metadata in v3 to
   enable this later.

4. **Patch promotion to AGENTS.md:** A graduated patch requires human approval to become
   a permanent constraint. Who reviews it? The Tech Lead in the next session. The flag
   persists in `prompt-patches.json` under `status: graduated` until explicitly promoted
   or explicitly rejected (human decision logged in the patch entry).
