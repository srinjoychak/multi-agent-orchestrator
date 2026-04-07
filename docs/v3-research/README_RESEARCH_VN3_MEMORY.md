# VN-Squad v3 Memory Systems Research — Complete Index

**Research Period**: 2026-04-07  
**Status**: Complete and ready for architecture review  
**Scope**: Six agent memory systems + recommended hybrid approach for VN-Squad v3

---

## Research Deliverables (3 Documents)

### 1. **RESEARCH_SUMMARY_V3_MEMORY.md** — START HERE
**Purpose**: Executive summary for decision-makers  
**Length**: ~4,000 words  
**What you'll find**:
- Quick comparison matrix of all 6 projects
- One-page summary of each system (strengths/weaknesses/verdict)
- Why VN-Squad v2's file-based system is actually good
- **The recommended path** (highest ROI, lowest risk): ACE + Self-Evolving-Agents
- 4-phase implementation roadmap (1-2 months total)
- Key metrics to track
- Decision gates and risk mitigation

**Best for**: Tech Lead, architects, decision-makers. Read this first.

---

### 2. **RESEARCH_VN3_MEMORY_SYSTEMS.md** — Technical Deep Dive
**Purpose**: Complete technical analysis of all 6 projects  
**Length**: ~10,000 words  
**What you'll find**:
- Detailed architecture analysis for each project:
  - Mem0 (vector-based memory)
  - MemInsight (consolidation-focused)
  - ACE (context frames) — **RECOMMENDED**
  - Self-Evolving-Agents (skill library) — **RECOMMENDED**
  - Self-Improving Coding Agent (git-native)
  - ai42z (knowledge graph)
- For each: architecture, mechanics, knowledge types, multi-agent coordination, code patterns, fit with VN-Squad, adoption feasibility
- **Synthesis section**: 7 key topics for multi-agent systems
  - Shared vs per-agent memory (tradeoffs)
  - Skill caching patterns
  - Hot-path optimization
  - Memory consolidation mechanics
  - Cross-vendor memory (Claude/Gemini/GPT)
  - Write amplification (sync vs async)
  - Failure recovery & replay
- Implementation roadmap (4 phases, details)
- Risk assessment
- Project comparison matrix

**Best for**: Implementers, architects, deep technical review. Read for context on each project.

---

### 3. **RESEARCH_ARCHITECTURE_V3_MEMORY.md** — Implementation Spec
**Purpose**: Detailed design reference for building the system  
**Length**: ~8,000 words  
**What you'll find**:
- System architecture diagram (full stack)
- Data models with JSON examples:
  - ACE Context Frames
  - Experience Records (episodic memory)
  - Skill Registry entries
  - Consolidated Memories (semantic)
  - Metadata & versioning
- TypeScript interfaces for all modules
- Memory storage layer API
- Experience logger (middleware)
- Consolidation engine
- **Phased rollout plan** (4 phases, week-by-week):
  - Phase 1: Context frames (1-2 weeks)
  - Phase 2: Experience logging (2 weeks)
  - Phase 3: Skill registry (2 weeks)
  - Phase 4: Consolidation (2 weeks)
- Complete data flow walkthrough (6 steps from task dispatch to consolidation)
- Query examples
- Failure modes & recovery
- Performance characteristics
- Integration checklist

**Best for**: Implementers, engineers, detailed technical planning. Use this to write code.

---

## Quick Navigation

**I want to...**

| Goal | Start Here |
|------|-----------|
| Decide if v3 should have a new memory system | SUMMARY (page 1) |
| Understand what ACE and Self-Evolving-Agents are | SUMMARY (project summaries) |
| Get technical details on one project | DEEP DIVE (project section) |
| See how shared vs isolated memory compares | DEEP DIVE (synthesis section 1) |
| Learn about memory consolidation | DEEP DIVE (synthesis section 4) + ARCHITECTURE (data flow) |
| Plan a 4-phase rollout | SUMMARY (recommended path) + ARCHITECTURE (timeline) |
| Design the context frame schema | ARCHITECTURE (data model section 1) |
| Implement experience logging | ARCHITECTURE (module interfaces + timeline phase 2) |
| Understand failure recovery | ARCHITECTURE (failure modes section) |
| Get performance benchmarks | ARCHITECTURE (performance section) |
| Create an integration checklist | ARCHITECTURE (integration checklist) |

---

## Key Findings

### Recommended Architecture: Hybrid ACE + Self-Evolving-Agents

**Why this combo?**
- **ACE (Agentic Context Engineering)**: Naturally aligns with VN-Squad v2's task-based workflow. Each task gets an explicit context frame with goal, constraints, and outcome. Minimal code changes, huge observability gain.
- **Self-Evolving-Agents**: Extracts reusable skill patterns from successful tasks. Tech Lead already does repetitive tasks (plan → dispatch → review); codify them.
- **MemInsight (Bonus)**: Weekly consolidation converts episodic memories into semantic patterns for MEMORY.md.

**What you get**:
- 80% of Mem0's intelligence (automatic learning from experience)
- 20% of the complexity (no external services, no embeddings)
- Zero breaking changes to existing workflow
- Natural fit with AGENTS.md + CLAUDE.md

### Why NOT the Others

| Project | Why Skip (for v3) |
|---------|-------------------|
| **Mem0** | Requires FAISS/embeddings service; changes fundamental memory model from manual to auto-capture |
| **MemInsight** | Good but stand-alone; better as Phase 2 addition on top of ACE |
| **Self-Improving Coding** | Domain-specific to code; useful for Phase 2, not v3 foundation |
| **ai42z** | Good for long-term policy capture, but requires graph DB + ontology design |

### Implementation Cost

**Phase 1 (ACE Context Frames)**: 1-2 weeks
- Minimal changes to AGENTS.md
- New module: context-frame.js
- Middleware in task dispatch
- **Result**: Full context tracking, zero regressions

**Phase 2 (Experience Logging)**: 2 weeks
- New module: experience-logger.js
- Classification logic (Gemini-based)
- **Result**: Historical data for pattern detection

**Phase 3 (Skill Registry)**: 2 weeks
- New module: skill-extractor.js
- Skill suggestion in /dispatch
- **Result**: Tech Lead sees "92% success rate, recommended workflow"

**Phase 4 (Consolidation)**: 2 weeks
- New module: consolidate-memory.js
- Weekly scheduled job
- Auto-populate MEMORY.md
- **Result**: Semantic memories emerge automatically

**Total**: ~1-2 months. **Result**: Production-quality memory system.

---

## How to Use These Documents in Decision-Making

### For Architecture Review
1. Read **SUMMARY** completely (~30 min)
2. Skim **DEEP DIVE** (Sections 3, 4 for ACE + Self-Evolving-Agents) (~20 min)
3. Review **ARCHITECTURE** data model section (~15 min)
4. Decision meeting: Do we move forward with Phase 1?

### For Implementation Planning
1. Read **ARCHITECTURE** timeline completely
2. For each phase, use:
   - "Files to create/modify"
   - "Test" section (what defines success)
   - Data models (exact JSON schemas)
   - Module interfaces (what to implement)
3. Build phase by phase; integrate test after each phase

### For Team Handoff
1. Present **SUMMARY** to team (30 min talk)
2. Publish all 3 documents for reference
3. Use **ARCHITECTURE** for code review (are changes following spec?)
4. Track progress against Phase timeline

---

## Key Sections to Reuse

### For AGENTS.md v3 Update
See: **ARCHITECTURE** → "ACE Context Frame" data model  
Copy the context frame structure into task template standard.

### For Implementation Guidance
See: **ARCHITECTURE** → "Module Interfaces" and "Phased Rollout" sections  
Use TypeScript interfaces as code spec; follow phase order.

### For Integration Testing
See: **ARCHITECTURE** → "A Complete Example" data flow section  
Walk through a real refactoring task and verify each step works.

### For Failure Handling
See: **ARCHITECTURE** → "Failure Modes & Recovery" section  
Build these recovery protocols into the consolidation engine.

---

## Questions to Discuss with Team

After reading **SUMMARY**:

1. **Commitment**: Do we want to build a learning-capable agent orchestrator in v3?
2. **Scope**: Should Phase 1 ship in v3-alpha, or v3.0.1?
3. **Ownership**: Who owns consolidation engine (Gemini-based module)?
4. **Metrics**: What's our success metric? (skill registry size? consolidation ratio? task completion time?)
5. **Privacy**: Should memory be per-project or shared across projects?
6. **Audit**: Do we need compliance tracking (who learned what, when)?

---

## Appendix: References

### External Projects Analyzed
- [Mem0](https://github.com/mem0ai/mem0) — Long-term memory for LLM agents
- [ACE](https://github.com/ace-agent/ace) — Agentic Context Engineering framework
- [Self-Evolving-Agents](https://github.com/CharlesQ9/Self-Evolving-Agents) — Multi-agent learning
- [Self-Improving Coding Agent](https://github.com/MaximeRobeyns/self_improving_coding_agent)
- [ai42z](https://github.com/balakhonoff/ai42z) — Knowledge graph + refinement

### VN-Squad v2 Context
- **CLAUDE.md**: Tech Lead instructions (stay in sync with v3)
- **AGENTS.md**: Subagent prompt standard (update for context frames)
- **agents.json**: Agent capability map (add new /consolidate-memory skill)

### Architecture & Design Patterns
- **Context frames**: From ACE agent framework
- **Experience log + skill library**: From Self-Evolving-Agents
- **Memory consolidation**: From MemInsight research
- **Write amplification**: From distributed systems literature (Kafka, etc.)

---

## Document Versioning

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-07 | Initial research release (3 documents) |

---

## How to Contribute Feedback

After reading these documents:

1. Open a discussion thread in the team chat
2. Tag specific sections (e.g., "ARCHITECTURE: Risk Assessment")
3. Propose changes or alternatives
4. After consensus, update the relevant document
5. Keep MEMORY.md in sync (decision log)

---

## Final Recommendation

**Move forward with Phase 1 (ACE Context Frames) in v3-alpha.**

Reasons:
1. **Low risk**: Middleware only, no task code changes
2. **High value**: Immediate visibility into task execution (context frames become audit trail)
3. **Foundation**: Enables Phases 2-4 without rework
4. **Aligned**: Natural fit with existing AGENTS.md + CLAUDE.md design
5. **Timeline**: 1-2 weeks to Phase 1 completion

**Success criteria for Phase 1**:
- Zero regressions in existing /dispatch tasks
- 100% context capture on all tasks
- Context data is useful for future pattern analysis
- No external dependencies added

Once Phase 1 lands and stabilizes, proceed to Phase 2 (experience logging) with confidence.

---

**Status**: ✅ Research complete  
**Next**: Team review meeting + decision on Phase 1 commitment

For questions, see the detailed sections in the 3 documents above.
