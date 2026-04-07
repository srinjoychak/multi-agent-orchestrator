# VN-Squad v3 Research Stream 2: Memory, Reflection & Caching Systems

**Date**: 2026-04-07  
**Research Scope**: Six agent memory architectures + multi-agent caching strategies  
**Status**: Complete — Ready for v3 architecture design  

## Executive Summary

This research examines six production agent memory systems and synthesizes their architectural patterns for potential integration into VN-Squad v3. The analysis covers Mem0, MemInsight, ACE, Self-Evolving-Agents, Self-Improving Coding Agent, and ai42z.

**Key Finding**: VN-Squad v2's file-based manual memory system is sound but lacks:
- Automatic experience recording
- Cross-task pattern consolidation
- Shared skill discovery
- Context tracking across task boundaries
- Failure recovery & replay

**Recommendation**: Hybrid approach combining ACE (context frames), Self-Evolving-Agents (skill library), and MemInsight (consolidation) gives 80% of Mem0's intelligence with 20% of complexity.

---

## PROJECT ANALYSES

### 1. Mem0 (https://github.com/mem0ai/mem0)

**Memory Architecture:**
- **Type Hierarchy**: Episodic (raw events) → Semantic (consolidated facts) → Composite (multi-context facts)
- **Organization**: Flat vector store (embeddings-based) with metadata tagging
- **Indices**: 
  - FAISS vector index for semantic similarity
  - Hash-based lookup on entity names/categories
  - Time-based indices for temporal queries

**Write/Read/Evict Mechanics:**
- **Write triggers**: After each agent interaction; configured thresholds (e.g., consolidation on 10+ memories)
- **Retrieval**: Hybrid search combining vector similarity + keyword/metadata filters
- **Eviction**: Importance-scoring (based on access frequency, recency, semantic density); configurable TTL

**Knowledge Types:**
- Facts: Structured entity-value pairs ("User prefers X")
- Patterns: Aggregate insights from multiple similar interactions
- Preferences: User/system behaviors and constraints
- Interaction context: Full message history + outcomes

**Multi-Agent Coordination:**
- Shared memory pool via backend API (PostgreSQL/similar)
- Agent isolation via user/session IDs
- Synchronous writes; eventual consistency on reads

**Code Patterns:**
- Hook-based architecture: `before_interaction()`, `after_interaction()`, `consolidate()`
- Middleware for automatic memory capture on LLM calls
- Serialization: JSON metadata + vector embeddings
- Async consolidation job separate from query path

**Fit with VN-Squad v2:**
- **Compatibility**: Partial. VN-Squad v2's MEMORY.md index and file-based system are fundamentally different from Mem0's vector store approach
- **What breaks**: No vector embeddings in v2; manual memory writes vs automatic capture
- **Required changes**: 
  - Add embedding generation service
  - Introduce JSON-serialized memory records with vectors
  - Background consolidation daemon
  - Semantic retrieval instead of file-based index

**Adoption Feasibility: 2/5**
- Requires adding external dependencies (FAISS, embeddings service)
- Changes fundamental memory model from manual to automatic
- Significant engineering to adapt to Claude Code's constraints

---

### 2. MemInsight (Auto Memory Evolution/Consolidation)

**Memory Architecture:**
- **Type Hierarchy**: Raw episodic → Incremental summaries → Semantic abstraction
- **Organization**: Multi-level pyramid with configurable consolidation triggers
- **Indices**: Temporal (by timestamp), categorical (by memory type), dependency graphs

**Write/Read/Evict Mechanics:**
- **Write triggers**: Configurable: on access count, on similarity threshold, on time decay
- **Retrieval**: Weighted combination of recency, relevance (semantic), and frequency
- **Eviction**: Two-phase: mark as "candidate for consolidation" → create abstraction → discard original

**Knowledge Types:**
- Episodic: Original interaction transcripts
- Semantic: Consolidated generalizations ("Team X prefers async communication")
- Procedural: Repeated patterns ("Always run tests before deploy")
- Preferences: System constraints and user preferences

**Multi-Agent Coordination:**
- Supports shared memory with agent-specific filters
- Memory tagged with agent ID for isolation
- Consolidation runs asynchronously without blocking queries

**Code Patterns:**
- Consolidation middleware: `abstract(memories[]) → generalization`
- Sliding window for temporal grouping
- Semantic similarity clustering before consolidation
- Versioning: keep original + abstraction for audit trails

**Fit with VN-Squad v2:**
- **Compatibility**: Good. Can be layered on top of v2's file-based system
- **What breaks**: Nothing, if implemented as a post-processing layer
- **Synergies**: 
  - Could consolidate old MEMORY.md entries periodically
  - Could add version tracking to memory files
  - Could implement "insight generation" as a skill (/gemini-based consolidation)

**Adoption Feasibility: 3/5**
- Could extend existing file-based system without rework
- Requires consolidation logic (could be Gemini-based)
- Minimal impact on Tech Lead workflow

---

### 3. ACE (Agentic Context Engineering) (https://github.com/ace-agent/ace)

**Memory Architecture:**
- **Type Hierarchy**: Working context (current task) → Episodic context (recent history) → Long-term context (persistent knowledge)
- **Organization**: Context frames with explicit roles (goal, constraints, current state, recent events)
- **Indices**: Task ID, agent ID, context type, temporal windows

**Write/Read/Evict Mechanics:**
- **Write triggers**: Explicit context saves at task boundaries; automatic snapshots on state changes
- **Retrieval**: Context lookup by task ID + time window; active reasoning over context
- **Eviction**: Age-based (remove after N days) or space-based (cap context size)

**Knowledge Types:**
- Operational: Current task goals, constraints, agents involved
- Historical: Decisions made, outcomes, lessons learned
- Architectural: System capability registry, integration points
- Debugging: Interaction transcripts, error traces

**Multi-Agent Coordination:**
- Shared context frames accessible to all agents
- Read-only contexts for shared knowledge; exclusive write-lock for working contexts
- Context merging on task completion (e.g., propagate decision reasoning to long-term)

**Code Patterns:**
- Context objects as first-class entities: `Context(task_id, agent_id, frame_type)`
- Serialization: YAML/JSON with schema validation
- Middleware for automatic context capture on agent execution
- Reasoning engine introspection (store model's own reasoning steps)

**Fit with VN-Squad v2:**
- **Compatibility**: Excellent. Aligns with CLAUDE.md's task-based workflow
- **What breaks**: Nothing. Could enhance current system
- **Synergies**:
  - Task prompt becomes explicit context frame
  - Subagent execution wrapped in context capture
  - Task outcomes automatically summarized to long-term context
  - Decision reasoning (from /argue skill) explicitly versioned

**Adoption Feasibility: 4/5**
- Minimal schema changes to VN-Squad v2
- Could be added as middleware in task dispatch
- Naturally aligns with existing Tech Lead workflow

---

### 4. Self-Evolving-Agents (https://github.com/CharlesQ9/Self-Evolving-Agents)

**Memory Architecture:**
- **Type Hierarchy**: Experience (task execution records) → Skill library (reusable solution patterns) → Meta-skills (knowledge about how to learn)
- **Organization**: Experience log + indexed skill registry + reflection rules
- **Indices**: By problem type, solution success rate, execution time, dependencies

**Write/Read/Evict Mechanics:**
- **Write triggers**: After every task completion; skill extraction happens when success threshold crossed (N successful uses)
- **Retrieval**: Problem classification → lookup matching skills by type and success rate
- **Eviction**: Low-success-rate skills marked as "deprecated"; old experiences pruned by age

**Knowledge Types:**
- Experiences: Full task + solution + outcome + metrics
- Skills: Problem signature → solution template + success metrics
- Meta-knowledge: "This agent struggles with X; suggest Y approach"
- Failure cases: Problems where even best skills fail (for human escalation)

**Multi-Agent Coordination:**
- Shared skill library with agent-specific adaptation records
- Agents learn from each other's successes
- Skill usage metrics tracked per-agent for personalization

**Code Patterns:**
- Experience recording: `@record_experience` decorator on agent execution
- Skill extraction: `extract_skill(experience) → Skill(signature, template, success_rate)`
- Reflection loop: `reflect_on_failures() → suggest_new_approach()`
- Serialization: Skills as Python/JSON templates with parameterized placeholders

**Fit with VN-Squad v2:**
- **Compatibility**: Very good. Natural extension to skill system
- **What breaks**: Nothing. Could enhance /skills registry
- **Synergies**:
  - Task execution records become experience logs
  - Successful dispatches become skill templates
  - Codex adversarial reviews become failure analysis
  - /gemini-based research becomes indexed skill

**Adoption Feasibility: 4/5**
- Extends existing /skills framework naturally
- Requires experience recording middleware (low-risk)
- Skill extraction logic implementable in Gemini

---

### 5. Self-Improving Coding Agent (https://github.com/MaximeRobeyns/self_improving_coding_agent)

**Memory Architecture:**
- **Type Hierarchy**: Code solution (commit) → Test results (pass/fail) → Learned patterns ("avoid this pattern")
- **Organization**: Git history as episodic; parsed AST + test metrics as semantic
- **Indices**: By error type, solution pattern, test coverage, mutation score

**Write/Read/Evict Mechanics:**
- **Write triggers**: After each code generation + test cycle
- **Retrieval**: Error message → historical similar errors + solutions
- **Eviction**: Keep last N commits; prune by mutation score improvement

**Knowledge Types:**
- Code patterns: Syntax structures that pass tests; anti-patterns that fail
- Test insights: Which test types catch which bugs; coverage gaps
- Performance profiles: Solution quality metrics (latency, correctness, coverage)
- Failure analyses: Why specific approaches fail; constraints discovered

**Multi-Agent Coordination:**
- Shared codebase (git history serves as collective memory)
- Per-developer branches for isolation
- Test suite as shared validation ground truth

**Code Patterns:**
- AST analysis for pattern extraction
- Test harness integration for automatic validation
- Commit message parsing for intent capture
- Diff analysis to categorize changes

**Fit with VN-Squad v2:**
- **Compatibility**: Excellent for code-focused work. Git history already available
- **What breaks**: Nothing
- **Synergies**:
  - Git commits become experience records
  - Test results become feedback signals
  - Code review patterns (from /review) become learned heuristics
  - Failed tests trigger reflection (Gemini-based analysis)

**Adoption Feasibility: 4/5**
- Leverages existing git infrastructure
- Minimal new dependencies
- Natural fit with existing test/review workflow

---

### 6. ai42z (Knowledge Accumulation + Decision Refinement) (https://github.com/balakhonoff/ai42z)

**Memory Architecture:**
- **Type Hierarchy**: Raw facts → Domain ontology → Decision rules → Feedback signals
- **Organization**: Knowledge graph with typed nodes (concepts) and edges (relationships)
- **Indices**: By concept, relationship type, confidence score, source

**Write/Read/Evict Mechanics:**
- **Write triggers**: New facts logged explicitly; relationships inferred on query (lazy consolidation)
- **Retrieval**: Graph traversal starting from relevant concepts; confidence-weighted results
- **Eviction**: Low-confidence edges pruned; contradictions resolved via version history

**Knowledge Types:**
- Domain facts: Entities and their properties
- Relationships: How concepts relate (causal, categorical, temporal)
- Decision rules: "If X then Y" derived from facts
- Feedback: Outcomes used to refine confidence scores

**Multi-Agent Coordination:**
- Centralized knowledge graph (single source of truth)
- Agents add facts and query graph
- Conflict resolution via consensus (multiple agents must agree)
- Version tracking for disputed facts

**Code Patterns:**
- Graph database integration (Neo4j-like or RDF store)
- Fact representation: `Fact(subject, predicate, object, confidence, timestamp, source)`
- Rule engine: Forward chaining over facts to derive new conclusions
- Feedback loop: Outcomes update confidence scores

**Fit with VN-Squad v2:**
- **Compatibility**: Good for architectural/design decisions
- **What breaks**: Nothing
- **Synergies**:
  - /argue decisions become knowledge graph entries
  - DESIGN.md becomes formalized as facts + rules
  - Feedback from reviews refines confidence scores
  - Cross-project patterns emerge from graph analysis

**Adoption Feasibility: 3/5**
- Requires graph database (or lightweight RDF implementation)
- Schema design effort (ontology definition)
- Good for policy/decision capture, less for episodic events

---

## SYNTHESIS: Memory & Skill Caching Strategies for Multi-Agent Systems

### 1. Shared Memory Pool vs Per-Agent Memory

**Shared Pool Architecture:**
```
┌─────────────────────────────┐
│   Centralized Memory Store  │
│  (Vector DB / Graph / KV)   │
└──────────┬──────────────────┘
           │
    ┌──────┴──────┬──────────┬──────────┐
    │             │          │          │
  Agent-1      Agent-2    Agent-3    Agent-4
(isolated       (isolated  (isolated  (isolated
 view)          view)      view)      view)
```

**Tradeoffs:**
| Aspect | Shared Pool | Per-Agent |
|--------|------------|-----------|
| Consistency | Strong (centralized) | Weak (eventual) |
| Latency | P99 higher (contention) | P99 lower (local) |
| Isolation | Requires access control | Natural isolation |
| Learning transfer | Fast (shared skills) | Slow (independent) |
| Failure blast radius | High (if pool fails) | Low (single agent) |
| Implementation | Complex (consensus) | Simple (no sync) |

**Best fit for VN-Squad v2**: Hybrid approach
- Shared long-term knowledge (design decisions, patterns)
- Per-agent episodic memory (task history)
- Async consolidation layer that promotes episodic→semantic

---

### 2. Skill/Tool Caching Patterns

**Pattern 1: Solution Template Registry**
```
Problem Type → [Success Rate | Template | Dependencies]
"refactor-code" → [0.92 | "run-plan → dispatch → review" | [plan, codex, review]]
"debug-test" → [0.87 | "run-test → analyze-fail → fix → verify" | [bash, codex]]
```

**Pattern 2: Semantic Deduplication**
- Group similar past tasks by problem signature
- Cache successful solutions by category
- Retrieve via: problem embedding → nearest templates → ranked by success rate

**Pattern 3: Incremental Skill Refinement**
```
Skill v1.0 (success: 70%) 
  ↓ [feedback from 5 uses]
Skill v1.1 (success: 82%)
  ↓ [feedback from 10 uses]
Skill v2.0 (success: 91%) ← promoted, v1.x deprecated
```

**Implementation for VN-Squad v2:**
- Add `.claude/skills/registry.json`: `{skill_id, success_rate, last_used, templates[]}`
- Extend `/dispatch` to check registry first
- Log outcomes (pass/fail/partial) to skill metrics
- Gemini-based skill extraction: `consolidate-skills` job runs weekly

---

### 3. Hot-Path Optimization

**Cache Locality Hierarchy:**
```
Level 0 (Latency ~1µs): In-memory LRU (current task context)
Level 1 (Latency ~10ms): Local filesystem cache (.claude/cache/)
Level 2 (Latency ~100ms): Embedding DB index (semantic search)
Level 3 (Latency ~500ms): Full memory store (backup / audit)
```

**For VN-Squad v2:**
- Level 0: Current task prompt + recent subagent outputs
- Level 1: MEMORY.md index + last-used skill templates
- Level 2: Gemini embeddings of key decision points (DESIGN.md)
- Level 3: Full git history + all archived memories

**Implementation:**
```bash
# L1 cache in .claude/cache/
memory-index.json          # In-memory view of MEMORY.md
skill-usage-stats.json     # L0→L1 promotion tracking
design-embeddings.json     # Embedding cache for /argue

# Invalidation: On memory write, refresh L0→L1
```

---

### 4. Memory Consolidation (Episodic → Semantic)

**Consolidation Pipeline:**
```
Raw Episodic (task execution)
  ↓ [Pattern matching + clustering]
Partial Semantic (common subsequences)
  ↓ [Generalization + parameterization]
Semantic Memory (reusable patterns)
  ↓ [Feedback incorporation]
Meta-Knowledge (know when/how to use)
```

**Concrete Example for VN-Squad v2:**
```
Episode 1: "Dispatch 3 parallel code tasks → merge into single review"
Episode 2: "Dispatch 3 parallel code tasks → merge into single review"
Episode 3: "Dispatch 2 parallel code tasks → merge into single review"
           ↓ Consolidation
Semantic: "Batch parallel code tasks (2-4) before review phase"
           ↓ Meta-learn
Meta-rule: "Use for refactors; NOT for critical fixes"
```

**Triggers for consolidation:**
- Episodic memory size exceeds threshold (e.g., 50 KB per agent)
- Time-based: weekly batch consolidation
- Access-based: frequently-accessed memories worth generalizing
- Explicit: `/consolidate-memory` skill

---

### 5. Cross-Vendor Memory (Claude / Gemini / GPT)

**Challenge**: Each vendor has different context constraints, reasoning styles, strengths

**Strategy: Canonical Memory Format + Vendor-Specific Views**
```
Canonical Format (JSON):
{
  "id": "mem-2026-03-29-001",
  "type": "pattern",
  "content": "When code path is >500 lines, split before dispatch to review",
  "confidence": 0.92,
  "learned_by": "claude-subagent",
  "validated_by": ["codex", "gemini"],
  "contexts": {
    "claude": "Few-shot prompt template",
    "gemini": "Embedding + keyword index",
    "gpt": "Tool call signature"
  }
}
```

**Per-Vendor Projection:**
- **Claude**: Full context; reasoning chains
- **Gemini**: Embeddings + keyword index; summary format
- **GPT**: Function signatures + few-shot examples

**Implementation:**
```bash
# Central memory store (canonical)
~/.claude/projects/*/memory/

# Vendor-specific views (derived)
~/.claude/projects/*/cache/claude-view.json
~/.claude/projects/*/cache/gemini-view.json
~/.claude/projects/*/cache/gpt-view.json

# Sync mechanism: trigger on memory write
# gemini-ask.js embeds relevant canonical memories into prompt
```

---

### 6. Write Amplification (Sync vs Async)

**Synchronous Write (Blocking):**
```
Agent → Memory.write() → Persist to disk → Return ✓
Cost: 50-200ms per write; no data loss
Risk: Task latency increases
```

**Asynchronous Write (Non-blocking):**
```
Agent → Memory.queue() → Immediate return ✓
        ↓ [background daemon]
        Persist to disk
Cost: 0ms perceived; batch I/O
Risk: Loss on crash; consistency issues
```

**For VN-Squad v2 (Recommendations):**
| Memory Type | Strategy | Justification |
|---|---|---|
| Current task context | Sync | No latency impact (<10ms writes); must not lose |
| Episodic events | Async | Can batch writes; eventual consistency OK |
| Long-term knowledge | Async | Lower frequency; consolidation happens offline |
| Failure cases | Sync | Critical for learning; tolerate latency |

**Implementation:**
```javascript
// In gemini-ask.js / claude-subagent dispatch
memory.log_immediate(event, priority='CRITICAL')  // Sync
memory.queue(event, priority='NORMAL')             // Async
// Daemon: process queue every 5s or on size threshold
```

---

### 7. Failure Recovery & Replay

**Consistency Model:**
- **At-most-once**: Memory writes are fire-and-forget; some loss acceptable
- **At-least-once**: Writes idempotent; duplicates filtered on read
- **Exactly-once**: Requires distributed consensus (expensive; not recommended)

**For VN-Squad v2: At-least-once**
- Memory entries versioned: `(id, version, timestamp)`
- Deduplication on read by `(id, content_hash)`
- Replay: Gemini-based script to re-derive semantic from episodic

**Recovery Protocol:**
```
Scenario: Agent crashes mid-task, memory queue has 5 unwritten events

Step 1: On restart, check memory queue
Step 2: Verify each queued event hasn't been written (check by hash)
Step 3: Re-write non-duplicates
Step 4: Replay task execution using memory + git log

Cost: ~10s recovery time; no data loss for CRITICAL priority writes
```

**Audit Trail:**
```json
{
  "event_id": "mem-2026-03-29-001",
  "original_timestamp": 1711702800,
  "write_timestamp": 1711702850,
  "agent": "claude-subagent",
  "task": "refactor-auth-middleware",
  "status": "persisted",
  "hash": "sha256:...",
  "version": 1
}
```

---

## Implementation Roadmap for VN-Squad v3

### Phase 1 (Minimal, 1-2 weeks)
- [ ] Add memory versioning and deduplication
- [ ] Implement async write queue
- [ ] Add memory consolidation trigger (time-based)
- [ ] Extend MEMORY.md index with metadata

### Phase 2 (Medium, 3-4 weeks)
- [ ] Add skill registry and success-rate tracking
- [ ] Implement /consolidate-memory skill (Gemini-based)
- [ ] Add cross-task pattern detection
- [ ] Shared memory pool for design decisions (DESIGN.md → graph)

### Phase 3 (Advanced, 5-8 weeks)
- [ ] Semantic embeddings for memory retrieval
- [ ] Cross-vendor memory views (canonical format)
- [ ] Agent performance analytics dashboard
- [ ] ACE-style context frames for task tracking

---

## Risk Assessment

**Highest-Risk Changes:**
1. **Shared memory pool** — requires strong access control; test thoroughly
2. **Async writes** — can lose data; use only for non-critical events
3. **Consolidation logic** — over-aggressive consolidation can lose nuance

**Safest Wins:**
1. Memory versioning + deduplication (mechanical, low-risk)
2. Skill registry (additive; doesn't break existing /dispatch)
3. Experience logging (append-only; safe)

---

## Recommended Starting Point for VN-Squad v3

**Best approach: Hybrid ACE + Self-Evolving-Agents + Phase 1 recovery**

1. **Add ACE-style context frames** to subagent execution
   - Each task gets explicit `Context(task_id, agent, goal, constraints, outcome)`
   - Minimal code change; aligns with AGENTS.md

2. **Implement experience logging** (Self-Evolving-Agents pattern)
   - Record every task execution: inputs, outputs, success metrics
   - Natural extension to existing audit trail

3. **Add memory consolidation** (MemInsight pattern)
   - Weekly `/consolidate-memory` job
   - Promote frequently-accessed memories to MEMORY.md
   - Compress old episodic to semantic

4. **Cross-agent skill sharing** (Self-Evolving-Agents pattern)
   - Successful dispatches become skill templates
   - Failed attempts tagged with error category
   - Registry indexed by success rate

This gives you 80% of Mem0's intelligence with 20% of the complexity.

---

## Appendix: Project Comparison Matrix

| Project | Architecture | Best For | Integration Cost | Learning Transfer |
|---------|--------------|----------|------------------|--------------------|
| **Mem0** | Vector store + FAISS | User preferences, context retrieval | High (external deps) | Excellent |
| **MemInsight** | Multi-level pyramid | Episodic→semantic conversion | Medium (Gemini-based) | Good |
| **ACE** | Context frames | Task tracking, reasoning capture | Low (middleware only) | Medium |
| **Self-Evolving-Agents** | Experience log + skill library | Cross-task pattern learning | Medium (registry) | Excellent |
| **Self-Improving Coding** | Git history as memory | Code pattern learning, test insights | Low (git-native) | Good (code domain) |
| **ai42z** | Knowledge graph | Design decisions, policy capture | High (RDF/graph DB) | Good (inference) |

---

## Key Takeaways

1. **No single system is perfect** — different workloads (code, decisions, user context) need different architectures
2. **VN-Squad v2's file-based system is solid** — adding structure (versioning, metadata) makes it more powerful
3. **ACE's context frames align naturally** with existing task-based workflow
4. **Self-Evolving-Agents' skill pattern** is the highest ROI for Tech Lead productivity
5. **Cross-vendor memory requires canonical format** to avoid lock-in
6. **At-least-once consistency** is the right tradeoff for this workload

**Next Steps**: 
- Share this research with the team
- Design detailed schemas for Phase 1 (versioning, deduplication)
- Prototype ACE context frames in AGENTS.md
- Implement experience logging in `gemini-ask.js` and task dispatch
