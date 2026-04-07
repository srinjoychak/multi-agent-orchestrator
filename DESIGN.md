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

## Proposed Approach: Option A — Minimal Evolutionary Layer

### Architecture Decision

**Adopt Option A (persistence layer on v2) as the v3 foundation.** Borrow architectural
*patterns* from Option B (AgentScope) and Option C (DSPy) without adopting their
*infrastructure requirements* (daemons, message brokers, databases, Python runtimes).

**Rationale:** The bottleneck in v2 is not infrastructure — it is feedback loops. Every
dispatch already produces all the signal needed for self-improvement (AGENT_RESULT blocks,
git diffs, review verdicts). The gap is that this signal evaporates at session end. Closing
the feedback loop requires only persistent writes to `.vn-squad/`, not a new runtime.

Option B (microservices + database) introduces fragility in VN-Squad's WSL2 environment
where background processes do not survive Windows restarts. Claude Code's conversation loop
is inherently synchronous; a message broker does not change this — it adds failure modes.

Option C (DSPy differentiable modules) requires a Python runtime and DSPy dependency for
an orchestration system that currently has zero runtime dependencies beyond Node.js. The
self-optimization benefit does not justify the dependency surface for VN-Squad's use case
(code orchestration, not research ML).

---

## The Persistence Layer: `.vn-squad/` Extension

All new v3 state lives in `.vn-squad/` (untracked, like `verify-state.json`). Plain JSON.
No new dependencies. The Tech Lead reads these files at session start; skills write to them
at dispatch completion.

```
.vn-squad/
├── verify-state.json            ← v2 (already exists)
├── skill-registry.json          ← NEW: every dispatch outcome (foundation)
├── session-context.json         ← NEW: live inter-agent knowledge sharing
├── skill-manifest.json          ← NEW: dynamic skill discovery (quick win)
├── trajectories/                ← NEW: full dispatch sequences (SE-Agent pattern)
│   └── <uuid>.json
├── skills/                      ← NEW: reusable solution snapshots (AgentFactory)
│   └── <task-type>-<hash>.json
├── prompt-patches.json          ← NEW: safe prompt evolution (no protected file mutation)
└── specialization-profile/      ← NEW: per-agent empirical performance
    ├── gemini-worker.json
    └── codex-worker.json
```

### Schema: skill-registry.json (foundation for all other gaps)

```json
{
  "schema_version": 1,
  "entries": [{
    "id": "uuid",
    "timestamp": "iso8601",
    "skill": "/dispatch",
    "agent": "gemini-worker",
    "model": "flash",
    "task_type": "code",
    "outcome": "EmptyDiff",
    "recovery_used": "codex-worker",
    "recovery_outcome": "success",
    "quality_signals": {
      "review_verdict": "APPROVE",
      "files_changed": 4
    }
  }]
}
```

### Schema: session-context.json (inter-agent knowledge sharing)

```json
{
  "session_id": "uuid",
  "conventions": {
    "module_pattern": "ESM with named exports",
    "error_handling": "Result<T, E> pattern"
  },
  "completed_tasks": [{
    "id": "task-1",
    "agent": "gemini-worker",
    "summary": "...",
    "files": ["src/auth/token.js"]
  }]
}
```

The Tech Lead writes `session-context.json` before dispatch; `/dispatch` injects relevant
sections into each agent's task prompt under a "Prior context" block. Agents are READ-ONLY
consumers of session context — only the Tech Lead writes to it.

### Schema: specialization-profile/<agent>.json

```json
{
  "agent": "gemini-worker",
  "strengths": [
    { "task_type": "research", "success_rate": 1.0, "sample_size": 8 }
  ],
  "weaknesses": [
    { "task_type": "code", "success_rate": 0.33, "failure_codes": ["EmptyDiff"], "sample_size": 12 }
  ],
  "constraints": ["embed full file contents inline", "--output-format json required"],
  "last_updated": "iso8601"
}
```

---

## The Self-Improvement Loop

```
Session start
  │
  ├── Tech Lead reads skill-registry.json + specialization-profiles
  │   → calibrates routing (overrides static AGENTS.md table if evidence is strong)
  │
  ├── Tech Lead writes session-context.json with initial conventions
  │
  ├── /dispatch → agents execute in worktrees
  │
  ├── Post-dispatch (existing):
  │   ├── Tier 1 classification: git diff --stat (external signal)
  │   ├── Tier 2 cross-check: AGENT_RESULT.files_changed
  │   └── Tier 3 advisory: prose patterns
  │
  ├── Post-dispatch (NEW v3):
  │   ├── Append outcome to skill-registry.json
  │   ├── Append task summary to session-context.json
  │   ├── If outcome == success + novel solution: snapshot to skills/<hash>.json
  │   └── If outcome == failure: Tech Lead may suggest prompt-patches.json addition
  │
  └── Session end: update specialization-profile/<agent>.json from registry aggregation
```

---

## The Five Debate Questions — Claude's Positions

### Q1: Is Option A sufficient, or does it plateau?

**Position: Option A is sufficient for 50+ dispatch cycles.** The plateau argument assumes
that the improvement signal is richer than a JSON file can capture. But in VN-Squad's
context, the highest-value signal is coarse: which agent succeeds on which task type, at
what rate, after what kind of failure. This is fully captured in `skill-registry.json`.

The plateau risk is real but occurs at a different horizon: after ~200 sessions, you may
want learned routing (MoA-style) rather than threshold-based routing. Option A is designed
to accumulate the data that would train such a router — it is not incompatible with Option
B/C, it just defers their infrastructure cost to when the data justifies it.

### Q2: Does Option B violate the lightweight principle?

**Position: Yes, in VN-Squad's specific environment, and the principle is worth preserving.**
WSL2 background daemons are fragile across Windows restarts. The value of VN-Squad's
"plain JSON + markdown" constraint is auditability and zero-ops maintenance: there is no
database to migrate, no broker to restart, no schema to version-control separately. Option A
preserves this. Option B is appropriate for teams with dedicated infra; VN-Squad's target
context is a single developer or small team running Claude Code locally.

### Q3: Minimum viable self-improvement loop for 50 cycles

**Position:** Three artifacts, one extended protocol:
1. `skill-registry.json` — every outcome logged (closes the feedback loop)
2. `session-context.json` — prior task summaries injected into subsequent dispatch prompts
3. `specialization-profile/<agent>.json` — routing calibration (auto-suggestion; human approves)

And one AGENT_RESULT extension: add `quality_signals.review_verdict` to the existing
protocol. This captures the quality dimension without changing the trust tier model.

Observable gains appear as soon as Codex is auto-suggested over Gemini for code tasks
where the registry shows Gemini's EmptyDiff rate > 50%. That is a routing improvement
with zero new infrastructure — just a Tech Lead reading a JSON file.

### Q4: Automatic routing vs recommendation requiring approval

**Position: Recommendation requiring Tech Lead approval until sample_size >= 10.**

Below 10 samples, the routing evidence is too thin to trust. Auto-routing on 3 data points
risks compounding errors. Above 10 samples with `success_rate < 0.5` on a task type, the
system PROPOSES a routing override: "Gemini has succeeded on 2/8 code tasks — recommend
routing to Codex." The Tech Lead confirms.

This is consistent with the v2 principle: for unverifiable or thin-evidence decisions,
human approval is the safeguard. Routing changes are consequential (they change which
agent receives which budget); they should not auto-apply on sparse data.

### Q5: Where does the "agents improving agents" loop close?

**Position: At the Tech Lead + human approval boundary. Always.**

Agents produce outputs. The Tech Lead observes, classifies (via tiered trust), and decides.
Prompt patches (`prompt-patches.json`) are suggested by the Tech Lead after observing a
failure pattern but require human approval before being applied to future dispatches.
Specialization profiles are updated from registry data but routing changes from them are
proposed, not automatic.

No agent modifies another agent's definition. No agent modifies its own skill file.
The improvement loop is: agent output → tiered trust classification → Tech Lead proposes →
human approves → registry updated → future routing calibrated. The closure point is human
judgment. This is the correct design for a system where `CompileRed` and `TestFail` are
already gated on human judgment — consistency demands the improvement loop follow the same
trust model.

---

## Key Tradeoffs

### T1: Option A plateau vs Option B infrastructure cost
Option A plateaus at threshold-based routing; Option B enables learned routing at the cost
of daemon fragility and ops complexity in WSL2. **Decision: Option A for v3; design
skill-registry schema to be compatible with a future MoA-style router if accumulated data
justifies it.**

### T2: Auto-routing vs human-approved routing
Auto-routing on empirical data is faster but risks compounding errors on thin samples.
Human-approved routing is slower but consistent with v2's trust model.
**Decision: recommendation-with-approval below sample_size 10; revisit threshold at v3.1.**

### T3: Agents as READ-ONLY consumers of session-context.json
Allowing agents to write to session-context.json enables richer sharing but opens a
self-report trust problem (an agent could write false context to influence a sibling).
**Decision: Tech Lead is the sole writer. Agents are read-only consumers via task prompt
injection. This preserves the Tier 1 independence principle.**

### T4: prompt-patches.json as the prompt evolution mechanism
Mutating protected skill files (CLAUDE.md, AGENTS.md) risks identity corruption.
prompt-patches.json is a separate, non-protected artifact that holds additive constraints
merged at dispatch time. Human must approve each patch addition.
**Decision: prompt-patches.json pattern adopted. Protected files never mutated.**

### T5: Trajectory capture scope
Recording every dispatch sequence in `trajectories/` enables SE-Agent-style replay and
learning. But trajectories grow unbounded. Without pruning, the directory becomes noise.
**Decision: Capture trajectories only for tasks with `outcome == success` AND
`quality_signals.review_verdict == APPROVE`. This keeps the library high-signal.**

---

## Open Questions

1. **Registry size management:** `skill-registry.json` grows unbounded. When should entries
   be pruned or archived? Proposal: rotate at 500 entries, archive to
   `skill-registry-<year>.json`.

2. **session-context.json lifecycle:** Does `session-context.json` reset on every new Claude
   Code session, or persist across sessions? If it persists, stale conventions from a prior
   feature branch could corrupt a new session. Proposal: reset on session start; seed from
   the current branch's last trajectory if one exists.

3. **Routing threshold calibration:** Is `sample_size >= 10` the right threshold for
   auto-suggestion? Too low risks noise; too high delays useful recommendations.
   Proposal: start at 10; adjust based on observed false-positive rate over first 100 cycles.

4. **Cross-vendor skill transfer:** When `skills/<hash>.json` captures a successful solution
   pattern, can it be offered as context to a different vendor agent on a similar task?
   This is the AgentFactory pattern — but requires task similarity scoring. Is cosine
   similarity on task description sufficient, or does this need structured task tagging?

5. **Improvement validation:** Who decides that a prompt patch has improved outcomes?
   Proposal: require 5 successes with the patch active before the patch is "graduated"
   from patch to permanent AGENTS.md update (requiring explicit human approval of the
   AGENTS.md change).
