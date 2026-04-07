# VN-Squad v3 Memory Systems Research — Executive Summary

**Date**: 2026-04-07  
**Status**: Research complete, ready for architecture discussion  
**Main Artifact**: `RESEARCH_VN3_MEMORY_SYSTEMS.md` (full technical report)

---

## Quick Comparison: Adoption Feasibility vs Intelligence Gain

```
Adoption Feasibility (1-5 scale, lower = easier)

        Easy                                 Hard
         ↓                                    ↓
Self-Improving Coding (4/5) ──┐
        Codex Scoring         │
Self-Evolving-Agents (4/5) ─┐ │
        ACE (4/5) ──────────┐ │ │
                   MemInsight│ │ │ (3/5)
                   ai42z (3/5)│ │ │
                              Mem0 (2/5) ← High external dependency burden
```

---

## One-Page Summaries

### Mem0 — Full-Featured Vector-Based Memory
- **Strength**: Automatic memory capture, semantic similarity search, composable facts
- **Weakness**: Requires FAISS/embeddings service, changes fundamental memory model
- **Why it's hard**: VN-Squad v2's manual memory is intentional design; auto-capture conflicts with file-based workflow
- **Best for**: Systems where users interact directly (chatbots); not ideal for agent orchestration
- **Verdict**: Skip for v3. Adds too much complexity vs ROI.

### MemInsight — Consolidation-Focused
- **Strength**: Simple episodic→semantic transformation, multi-level pyramid, zero breaking changes
- **Weakness**: Requires consolidation logic (parameterization, generalization)
- **Why it's good**: Can layer on top of existing file-based system
- **Best for**: Periodically cleaning up episodic memory into reusable patterns
- **Verdict**: Good Phase 2 addition. Consider for weekly consolidation job.

### ACE — Context Frames (RECOMMENDED)
- **Strength**: Natural alignment with task-based workflow, explicit goal/constraint/outcome tracking
- **Weakness**: Requires schema design (minimal), middleware for context capture
- **Why it's good**: AGENTS.md already describes task structure; ACE formalizes it
- **Best for**: Tracking reasoning, task context, learning across executions
- **Verdict**: Highest ROI for v3. Minimal code change, big observability gain. **Start here.**

### Self-Evolving-Agents — Experience + Skill Library (RECOMMENDED)
- **Strength**: Automatic skill extraction, shared success metrics, problem→solution indexing
- **Weakness**: Requires problem classification, skill template extraction logic
- **Why it's good**: Tech Lead has repetitive patterns (plan→dispatch→review); codify them
- **Best for**: Cross-task pattern reuse, teaching new agents, failure analysis
- **Verdict**: Second-highest ROI. Complements ACE nicely. **Phase 1.**

### Self-Improving Coding Agent — Git-Native
- **Strength**: Leverages existing git history, AST-based pattern learning, test integration
- **Weakness**: Domain-specific (code only); requires test suite integration
- **Why it's good**: Code tasks are 30%+ of VN-Squad work; extract patterns naturally
- **Best for**: Improving code quality over time, test-driven learning
- **Verdict**: Good Phase 2. Low risk, natural fit with existing /review workflow.

### ai42z — Knowledge Graph (Decision Capture)
- **Strength**: Formalizes design decisions, tracks confidence, enables inference
- **Weakness**: Requires graph DB or RDF store, ontology design effort
- **Why it's good**: DESIGN.md could become facts + rules; /argue gets formalized
- **Best for**: Policy capture, cross-project patterns, justified decisions
- **Verdict**: Phase 3. Good for long-term, but requires significant upfront schema work.

---

## Why VN-Squad v2's File-Based System Is Actually Good

**Don't discard it.** Key strengths:

1. **Explicit over implicit** — Tech Lead deliberately writes memory; forces thinking
2. **Auditable** — Every memory entry is git-tracked, reviewable
3. **Simple** — No dependencies, no schema migrations, clear semantics
4. **Safe** — No data loss, no async consistency issues
5. **Portable** — Works offline, no external services needed

**What it lacks:**
- Automatic experience capture (manually written only)
- Cross-task pattern detection (must be manually extracted)
- Skill consolidation (no registry of "what works")
- Failure recovery (no rollback or replay)
- Context frames (no structured task tracking)

**The right strategy:** Keep the foundation, add layers that enhance without replacing.

---

## The Recommended Path (Highest ROI, Lowest Risk)

### Phase 1: ACE Context Frames (1 week)
```javascript
// In task dispatch, wrap with explicit context
context = {
  task_id: "refactor-auth-middleware-003",
  agent: "claude-subagent",
  goal: "Split long middleware into smaller functions",
  constraints: ["don't change behavior", "maintain tests", "no external deps"],
  start_timestamp: Date.now(),
  outcome: null  // filled on completion
}

// Log context.outcome with: success, files_changed, tests_passed, metrics
```

**Impact**: Zero breaking changes, immediate observability gain. Can replay tasks using context + git log.

### Phase 2: Experience Logging (2 weeks)
```javascript
// After task completes, record experience
experience = {
  task_id: context.task_id,
  input: task_prompt,
  solution: agent_output,
  outcome: { success: true, metrics: {...} },
  timestamp: Date.now()
}

// Index by problem_signature (extracted by Gemini)
// Extract skill when: success_rate > 80% on similar problems
```

**Impact**: Historical data for pattern detection. Feed to `/consolidate-memory` skill.

### Phase 3: Skill Registry (2 weeks)
```javascript
// Weekly job: extract_skills_from_experiences()
// Build registry:
{
  "refactor-long-function": {
    success_rate: 0.92,
    template: "plan → dispatch(3 tasks) → merge-review",
    success_count: 12,
    failure_count: 1,
    last_used: "2026-04-05T14:22:00Z"
  }
}

// In future /dispatch, check registry first
// Suggest: "We've solved this 92% success rate with: ..."
```

**Impact**: Tech Lead learns which patterns work. Subagents benefit from success history.

### Phase 4: Memory Consolidation (2 weeks)
```javascript
// Weekly: consolidate_episodic_to_semantic()
// Group similar experiences by problem signature
// Extract: "When code exceeds N lines, split before review"
// Save to MEMORY.md automatically
```

**Impact**: Automatic MEMORY.md growth. Reduces need for manual memory writes. Promotes useful patterns to long-term.

**Total effort**: ~1-2 months. **Result**: 80% of Mem0's intelligence with file-based simplicity.

---

## What NOT to Do

❌ **Don't add embeddings/FAISS** — External dependency burden; no win over semantic clustering  
❌ **Don't auto-capture all interactions** — Defeats "explicit over implicit" design  
❌ **Don't build shared memory pool immediately** — Good for v4; v3 needs strong experience baseline first  
❌ **Don't implement graph DB for DESIGN.md** — Try fact-based approach first (simpler)  
❌ **Don't make consolidation aggressive** — Preserve nuance; when in doubt, keep original

---

## Key Metrics to Track (Phase 1+)

Once ACE context frames are in place, start collecting:

| Metric | Why | Tracking |
|--------|-----|----------|
| Task success rate | Baseline for skill extraction | context.outcome |
| Time to completion | Identify slow patterns | timestamp delta |
| Files changed per task | Gauge task scope | git diff size |
| Test coverage delta | Learn QA patterns | CI metrics |
| Memory consolidation ratio | Identify redundancy | MEMORY.md growth |
| Skill hit rate | How often suggestions help | /dispatch checks |
| Cross-agent pattern reuse | Knowledge transfer | skill usage by agent |

---

## Integration with VN-Squad v2's Existing Systems

### Compatibility: ✅ Full (with ACE + Self-Evolving-Agents approach)

**CLAUDE.md** — No changes needed. Skills can use new memory system as a library.

**AGENTS.md** — Add context frame standard to task template:
```
## Context Frame (for experience tracking)
- task_id: <auto-generated>
- agent: <subagent type>
- goal: <extracted from task description>
- constraints: <parsed from task requirements>
```

**agents.json** — New skill: `/consolidate-memory` (Gemini-based)

**gemini-ask.js** — Enhanced with experience logging hooks:
```javascript
// Before dispatch
context = new TaskContext(...)

// After completion
memory.log_experience(context, outcome)
```

**git history** — Unchanged. Commit history becomes part of experience record.

---

## Risk Mitigation

| Risk | Mitigation | Owner |
|------|-----------|-------|
| Context capture breaks existing tasks | Use middleware; no task code changes needed | Tech Lead |
| Experience logging becomes write-heavy | Async queue + batch consolidation | gemini-ask.js |
| Consolidation loses nuance | Keep episodic originals; consolidation is advisory only | Consolidation job |
| Skill registry gets stale | Monthly review; deprecate unused skills | Tech Lead review |
| Cross-agent conflicts on skill usage | Version skills; keep decision logs | metadata tracking |

---

## Decision Gate

**Go/No-Go for Phase 1 (ACE Context Frames)?**

Prerequisites:
- [ ] AGENTS.md updated with context frame template
- [ ] Task template example using context
- [ ] Zero existing task failures due to context capture
- [ ] Commit message standard updated to reference context.task_id

**Go condition**: All prerequisites met, no regressions in existing /dispatch workflow.

---

## Reading Order

1. **This file** (executive summary)
2. **RESEARCH_VN3_MEMORY_SYSTEMS.md** (technical deep dive)
3. **Recommended**: Section 3 (ACE) and Section 4 (Self-Evolving-Agents) of full report
4. **For Phase 2**: Section 2 (MemInsight) and cross-read Section 7 (consolidation mechanics)

---

## Contact for Questions

This research can inform the next v3 architecture working session. Key questions to discuss:

1. Is ACE context frame approach acceptable? (Low-risk, high-value)
2. Should we implement experience logging now or after Phase 1 stabilizes?
3. For DESIGN.md formalization: graph DB (ai42z), or simpler fact-based versioning?
4. How should cross-agent skill discovery work? Shared registry or per-agent learn?
5. When should async write queue be introduced? Phase 1 or later?

---

**Status**: ✅ Ready for design review  
**Next Step**: Team discussion on Phase 1 approach, then prototype ACE context frames in AGENTS.md
