# VN-Squad v3 Memory Architecture Reference

**Purpose**: Technical design reference for implementing recommended hybrid memory system  
**Scope**: ACE (context frames) + Self-Evolving-Agents (skill library) + MemInsight (consolidation)  
**Status**: Specification-ready for implementation planning

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      VN-Squad v3 Orchestrator                   │
│                     (Tech Lead / Subagent)                      │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ├─ /plan, /dispatch, /argue, /verify, /review, /finish
              │
    ┌─────────▼─────────┐
    │  Task Dispatch    │
    │  (AGENTS.md)      │
    └────┬──────────────┘
         │
         ├──────────────────────────┐
         │                          │
    ┌────▼─────────────┐    ┌──────▼──────────┐
    │  Context Capture │    │  Subagent       │
    │  (ACE Frames)    │    │  Execution      │
    └────┬─────────────┘    └──────┬──────────┘
         │                         │
    ┌────▼─────────────────────────▼──────┐
    │  Experience Logger (Phase 2)         │
    │  - Input/output capture              │
    │  - Success metrics                   │
    │  - Outcome classification            │
    └────┬────────────────────────────────┘
         │
    ┌────▼──────────────────────────────────┐
    │  Memory Pool (File-Based + Metadata)  │
    │  .claude/projects/*/memory/           │
    │  ├── MEMORY.md (index)                │
    │  ├── contexts/ (ACE frames)           │
    │  ├── experiences/ (episodic)          │
    │  ├── skills/ (registry)               │
    │  └── metadata.json (v.idx, hash)      │
    └────┬──────────────────────────────────┘
         │
    ┌────▼──────────────────────────────────┐
    │  Consolidation & Indexing (Weekly)    │
    │  /consolidate-memory skill             │
    │  - Episodic→Semantic extraction       │
    │  - Skill registry update               │
    │  - Pattern detection                  │
    │  - MEMORY.md refresh                  │
    └────┬──────────────────────────────────┘
         │
    ┌────▼──────────────────────────────────┐
    │  Memory Query Layer                   │
    │  - Context lookup (by task_id)        │
    │  - Skill search (by problem type)     │
    │  - Pattern matching (semantic)        │
    └──────────────────────────────────────┘
```

---

## Data Model: Core Structures

### 1. ACE Context Frame

```json
{
  "context_id": "ctx-2026-04-07-001",
  "task_id": "task-refactor-auth-2026-04-07",
  "agent": "claude-subagent",
  "agent_model": "claude-opus",
  "workflow_type": "refactor",
  
  "working_context": {
    "goal": "Split auth middleware into smaller, testable functions",
    "constraints": [
      "Preserve existing behavior",
      "Maintain test suite passing",
      "No external dependencies",
      "Max file size: 200 lines"
    ],
    "task_prompt": "# Task: Refactor auth middleware...",
    "start_time": "2026-04-07T14:30:00Z",
    "status": "in_progress"
  },
  
  "episodic_context": {
    "recent_tasks": [
      "task-add-tests-2026-04-06",
      "task-fix-bug-session-2026-04-05"
    ],
    "recent_decisions": [
      "Use async/await for consistency",
      "Add comprehensive logging"
    ],
    "recent_failures": [
      "Previous refactor: tight coupling discovered post-deploy"
    ]
  },
  
  "long_term_context": {
    "codebase_patterns": [
      "Use .utils suffix for utility files",
      "Keep middleware functions under 100 lines",
      "Always add integration tests for auth"
    ],
    "team_preferences": {
      "code_style": "ESLint standard",
      "review_process": "always test before review",
      "documentation": "JSDoc for public APIs"
    },
    "known_constraints": {
      "auth_system": "oauth2 + jwt",
      "test_framework": "jest",
      "ci_platform": "github-actions"
    }
  },
  
  "outcome": {
    "status": "success",
    "completion_time": "2026-04-07T15:12:00Z",
    "files_changed": {
      "middleware/auth.js": { "added": 45, "removed": 78, "net": -33 },
      "tests/auth.test.js": { "added": 120, "removed": 30, "net": 90 }
    },
    "metrics": {
      "test_pass_rate": 1.0,
      "code_coverage_delta": "+12%",
      "function_complexity": "reduced from avg 8 to avg 4",
      "lines_per_function": "reduced from avg 45 to avg 22"
    },
    "lessons_learned": [
      "Pre-planning with AST analysis would have saved 15 min",
      "Test-driven refactoring caught edge case in token rotation"
    ]
  }
}
```

### 2. Experience Record (Episodic Memory)

```json
{
  "experience_id": "exp-2026-04-07-001",
  "context_id": "ctx-2026-04-07-001",
  "timestamp": "2026-04-07T15:12:00Z",
  
  "problem_signature": {
    "type": "refactor",
    "domain": "auth",
    "complexity": "high",
    "scope": "single-file",
    "lines_of_code": 150,
    "num_functions": 6,
    "test_coverage_before": 0.78
  },
  
  "solution_applied": {
    "workflow": ["plan", "dispatch", "review", "merge"],
    "agents": ["claude-subagent", "codex"],
    "dispatch_strategy": "single-task (not parallel)",
    "key_decision": "Use @refactor decorator to track changes",
    "tools_used": ["git", "jest", "eslint"]
  },
  
  "outcome": {
    "success": true,
    "metrics": {
      "completion_time_minutes": 42,
      "test_pass_rate": 1.0,
      "code_review_feedback": "approved with 0 changes requested",
      "complexity_reduction": 0.5,
      "code_coverage_delta": 0.12
    }
  },
  
  "related_experiences": [
    "exp-2026-03-29-002",  // Similar refactor, different domain
    "exp-2026-02-15-001"   // Related test improvements
  ]
}
```

### 3. Skill Registry Entry

```json
{
  "skill_id": "skill-refactor-long-function",
  "version": "2.0",
  "status": "active",
  "created_date": "2026-02-15",
  "last_updated": "2026-04-05",
  
  "problem_signature": {
    "type": "refactor",
    "target": "long-function",
    "lines_threshold": 100,
    "complexity_threshold": "high",
    "keywords": ["split", "extract", "simplify"]
  },
  
  "solution_template": {
    "workflow": "plan → dispatch → review → merge",
    "dispatch_config": {
      "num_agents": 1,
      "agent_type": "claude-subagent",
      "model": "claude-opus",
      "parallel": false
    },
    "review_config": {
      "require_codex_review": true,
      "automated_checks": ["complexity", "coverage", "style"]
    },
    "estimated_time_minutes": 45,
    "effort_level": "medium"
  },
  
  "success_metrics": {
    "total_uses": 47,
    "successful_uses": 43,
    "failed_uses": 2,
    "partial_uses": 2,
    "success_rate": 0.915,
    "avg_completion_time_minutes": 48,
    "avg_code_quality_improvement": 0.31,
    "avg_test_coverage_delta": 0.18,
    "user_satisfaction": 0.92
  },
  
  "notes": [
    "High success rate for functions >200 lines",
    "Moderate success for 100-200 line functions",
    "Not recommended for <100 line functions (too expensive)",
    "Enhanced success when combined with test-first approach"
  ],
  
  "deprecation_info": null,
  "dependencies": ["refactor-skill-base", "code-analysis-utils"],
  "compatible_domains": ["backend", "middleware", "utilities"],
  "incompatible_domains": ["UI-components", "config-files"]
}
```

### 4. Consolidated Memory (Semantic)

```json
{
  "memory_id": "mem-2026-04-07-001",
  "type": "pattern",
  "version": 1,
  "created_from_experiences": [
    "exp-2026-02-15-001",
    "exp-2026-03-01-005",
    "exp-2026-03-15-002",
    "exp-2026-04-01-008",
    "exp-2026-04-07-001"
  ],
  
  "content": {
    "title": "Large-File Refactoring: Split Before Review",
    "rule": "When refactoring a file exceeds 200 lines of code, use a split-first strategy: (1) plan breaking points using AST analysis, (2) create extracted functions with isolated concerns, (3) run tests after each extraction, (4) perform single code review at end.",
    "confidence": 0.94,
    "applicability": {
      "file_size_threshold": 200,
      "complexity_threshold": 8,
      "domains": ["backend", "middleware"],
      "anti_patterns": "Do NOT use this for UI components or config files"
    },
    "benefits": {
      "faster_review_process": "Smaller diffs reduce review latency by ~40%",
      "fewer_test_failures": "Early testing catches issues immediately",
      "better_code_quality": "Smaller functions are naturally better tested"
    },
    "costs": {
      "extra_planning_time": "10-15 minutes for AST analysis upfront",
      "more_commits": "5-10 commits vs 1 monolithic commit"
    },
    "learned_in_context": [
      "Refactoring is not just about splitting code",
      "Order of extraction matters for complexity",
      "Test-driven extraction prevents regressions"
    ]
  },
  
  "related_memories": [
    "mem-2026-03-15-001",  // Code coverage best practices
    "mem-2026-02-28-003"   // Test-driven development workflow
  ]
}
```

### 5. Metadata & Versioning

```json
{
  "memory_metadata.json": {
    "version": "1.0",
    "last_updated": "2026-04-07T15:15:00Z",
    "stats": {
      "total_contexts": 247,
      "total_experiences": 1043,
      "total_skills": 34,
      "total_semantic_memories": 12,
      "total_size_bytes": 4857292,
      "consolidation_ratio": 0.023
    },
    "indices": {
      "contexts_by_task_id": "contexts/index_by_task_id.json",
      "experiences_by_problem_type": "experiences/index_by_type.json",
      "skills_by_success_rate": "skills/index_by_success.json",
      "semantic_by_domain": "semantic/index_by_domain.json"
    },
    "deduplication": {
      "method": "content_hash",
      "hash_algorithm": "sha256",
      "last_dedup_run": "2026-04-07T03:00:00Z",
      "duplicates_found_and_merged": 23
    },
    "integrity": {
      "last_verification": "2026-04-07T15:15:00Z",
      "all_checksums_valid": true,
      "orphaned_files": 0
    }
  }
}
```

---

## Module Interfaces

### Memory Storage Layer

```typescript
// ~/.claude/projects/*/memory/store.ts

interface ContextStore {
  save(context: AceContextFrame): Promise<string>  // returns context_id
  get(contextId: string): Promise<AceContextFrame | null>
  list(filter: { taskId?: string; agent?: string }): Promise<AceContextFrame[]>
  update(contextId: string, patch: Partial<AceContextFrame>): Promise<void>
}

interface ExperienceStore {
  record(experience: Experience): Promise<string>  // returns exp_id
  query(signature: ProblemSignature): Promise<Experience[]>
  getRelated(expId: string): Promise<Experience[]>
  delete(expId: string): Promise<void>  // for cleanup
}

interface SkillRegistry {
  upsert(skill: Skill): Promise<void>
  getByType(problemType: string): Promise<Skill[]>
  getBestMatch(signature: ProblemSignature): Promise<Skill | null>
  updateMetrics(skillId: string, outcome: TaskOutcome): Promise<void>
  list(filter?: { status?: 'active' | 'deprecated' }): Promise<Skill[]>
}

interface SemanticMemory {
  add(memory: ConsolidatedMemory): Promise<string>
  search(query: string): Promise<ConsolidatedMemory[]>
  findByDomain(domain: string): Promise<ConsolidatedMemory[]>
}

interface MetadataIndex {
  updateStats(): Promise<void>
  getStats(): Promise<MemoryStats>
  deduplicateMemories(): Promise<number>  // returns count deduped
  verifyIntegrity(): Promise<{ isValid: boolean; issues?: string[] }>
}
```

### Experience Logger (Middleware)

```typescript
// scripts/experience-logger.js

class ExperienceLogger {
  constructor(memoryPath: string) { }
  
  captureContext(task: Task, agent: string, goal: string, constraints: string[]): AceContextFrame
  // Called at task dispatch
  
  recordCompletion(
    contextId: string,
    success: boolean,
    output: string,
    metrics: TaskMetrics
  ): Promise<void>
  // Called after subagent completion
  
  extractProblemSignature(experience: Experience): ProblemSignature
  // Heuristic-based classification
}
```

### Consolidation Engine

```typescript
// scripts/consolidate-memory.js

class MemoryConsolidator {
  consolidateEpisodic(): Promise<ConsolidatedMemory[]>
  // Groups similar experiences by problem_signature
  // Extracts generalizations using Gemini
  // Returns semantic memories
  
  extractSkills(experiences: Experience[]): Promise<Skill[]>
  // Filter: success_rate > 0.80
  // Generate template from successful experiences
  // Return Skill objects
  
  updateRegistry(skills: Skill[]): Promise<void>
  // Merge with existing registry
  // Deprecate conflicting low-performing skills
  // Update success_rate metrics
  
  publishToMemory(semantics: ConsolidatedMemory[]): Promise<void>
  // Add to MEMORY.md
  // Tag with consolidation source
}
```

---

## Implementation Timeline: Phased Rollout

### Phase 1: Context Frames (Week 1-2)

**Files to create/modify:**
- `AGENTS.md` — Add context frame template to task standard
- `scripts/context-frame.js` — New module, context creation/serialization
- `.claude/projects/*/memory/contexts/` — New directory for storing contexts
- `.claude/projects/*/memory/metadata.json` — New metadata index

**Changes to existing:**
- `gemini-ask.js` — Wrap execution with context capture
- Task dispatch middleware — Create context at dispatch, update on completion

**Test:**
- Run 10 existing tasks; verify contexts are created and populated
- Verify context.outcome is properly recorded
- Verify git commits reference context.task_id (in message)

**Success criteria:**
- Zero breaking changes to existing /dispatch
- 100% context capture on successful tasks
- No performance degradation

---

### Phase 2: Experience Logging (Week 3-4)

**Files to create/modify:**
- `scripts/experience-logger.js` — Experience recording and classification
- `scripts/classify-problem.js` — Problem signature extraction (Gemini-based)
- `.claude/projects/*/memory/experiences/` — New directory
- `.claude/projects/*/memory/experiences/index_by_type.json` — New index

**Changes to existing:**
- `gemini-ask.js` — Call `experienceLogger.recordCompletion()` after task
- Task completion handlers — Pass metrics to logger

**Test:**
- Run 20 tasks of varying types (code, docs, refactor, debug)
- Verify experiences are indexed by problem type
- Verify related experiences are correctly found

**Success criteria:**
- 100% experience capture
- Problem classification accurate for known task types
- Query latency < 50ms for "find similar"

---

### Phase 3: Skill Registry (Week 5-6)

**Files to create/modify:**
- `scripts/skill-extractor.js` — Skill extraction from experiences
- `.claude/projects/*/memory/skills/` — New directory
- `.claude/projects/*/memory/skills/registry.json` — Skill registry
- `.claude/commands/extract-skills` — New CLI command

**Changes to existing:**
- `gemini-ask.js` — Check skill registry before executing; log usage metrics
- `/dispatch` — Suggest skills to Tech Lead

**Test:**
- Run 50 diverse tasks; extract skills when success_rate > 0.80
- Verify skill template accurately predicts future success
- Test skill suggestion in real dispatch

**Success criteria:**
- Registry contains 10+ stable skills
- Skill success rate predictions within 10% of actual
- Skill suggestion visible to Tech Lead without disrupting workflow

---

### Phase 4: Consolidation & Cleanup (Week 7-8)

**Files to create/modify:**
- `scripts/consolidate-memory.js` — Consolidation engine (Gemini-based)
- `.claude/commands/consolidate-memory` — Weekly job spec
- `.claude/projects/*/memory/semantic/` — New directory for consolidated memories
- `cron.json` — Schedule consolidation for weekly (e.g., Sunday 03:00 UTC)

**Changes to existing:**
- `MEMORY.md` — Auto-populated with consolidated entries (Tech Lead can still edit)
- Metadata index — Deduplication, verification

**Test:**
- Run consolidation on 500+ experiences
- Verify consolidated memories are accurate and useful
- Verify no information loss (originals preserved)
- Verify MEMORY.md remains readable and concise

**Success criteria:**
- Consolidation runs without errors
- No regression in memory query latency
- Semantic memories successfully generalize patterns
- Tech Lead finds auto-populated entries useful

---

## Data Flow: A Complete Example

**Scenario**: Tech Lead requests `/plan && /dispatch` for a refactoring task

```
1. PLAN PHASE
   Tech Lead: "/plan refactor auth middleware into smaller functions"
   
   ├─ Create context frame (context_id: ctx-2026-04-07-042)
   │  working_context.goal = "Refactor auth..."
   │  working_context.start_time = now()
   │
   └─ Check skill registry for "refactor-*" skills
      └─ Return: "skill-refactor-long-function (success: 0.92)"
         Suggest: "We've solved similar tasks 92% success rate with: plan → dispatch → review"

2. DISPATCH PHASE
   Tech Lead: "/dispatch refactor task"
   
   ├─ Load context (ctx-2026-04-07-042)
   ├─ Create subtask with context embedded in prompt
   ├─ Spawn subagent (claude-subagent) with:
   │  - Task requirements
   │  - Related past experiences (5 similar refactors)
   │  - Suggested workflow from skill registry
   │
   └─ Subagent executes (30-60 minutes)
      ├─ Generate code changes
      ├─ Run tests
      └─ Create diff

3. COMPLETION PHASE
   Subagent finishes:
   
   ├─ Update context.outcome:
   │  outcome.status = "success"
   │  outcome.files_changed = { ... }
   │  outcome.metrics = { test_pass_rate: 1.0, coverage_delta: +0.12, ... }
   │
   ├─ Create experience record:
   │  experience.problem_signature = extracted from task
   │  experience.solution_applied = { workflow: "plan → dispatch → review", ... }
   │  experience.outcome = context.outcome
   │
   ├─ Update context metadata:
   │  context.completion_time = now()
   │  context.experience_id = exp-2026-04-07-042
   │
   └─ Update skill metrics for "skill-refactor-long-function":
      success_count += 1
      success_rate = success_count / (success_count + failure_count)

4. REVIEW PHASE
   Tech Lead: "/review" (optional, but logged)
   
   ├─ Review recorded in context as decision artifact
   ├─ Feedback stored as related context metadata
   └─ Codex review findings added to experience for future learning

5. CONSOLIDATION PHASE (Weekly, automated)
   
   ├─ Fetch all experiences from past week (100+)
   ├─ Group by problem_signature:
   │  └─ "refactor-long-function": 23 experiences
   │     ├─ 21 successful (success_rate: 0.91)
   │     ├─ Extract semantic memory: "Large-File Refactoring: Split Before Review"
   │     ├─ Promote to MEMORY.md
   │     └─ Update skill-refactor-long-function v2.0 (success_rate: 0.91)
   │
   ├─ Identify new patterns (not yet in registry)
   │  └─ Suggest new skills for Tech Lead review
   │
   └─ Clean up:
      ├─ Deduplicate old experiences (if content_hash matches)
      ├─ Mark low-usage skills as deprecated
      └─ Update metadata.json with new stats

6. MEMORY QUERY PHASE
   Future task: "I need to refactor a 250-line file"
   
   ├─ Query skill registry by type: "refactor"
   ├─ Rank by success_rate
   ├─ Return top-3: skill-refactor-long-function (0.91), 
   │                skill-refactor-monolith (0.87),
   │                skill-refactor-unused-code (0.83)
   │
   └─ Suggest: "We've solved this successfully 91% of the time with [workflow]"
```

---

## Querying the Memory System

### Query 1: Find Similar Past Tasks
```javascript
// Tech Lead: "Has this pattern happened before?"
const related = await memory.query({
  type: 'refactor',
  domain: 'auth',
  lines_threshold: 200
})
// Returns: [exp-1, exp-2, exp-3] sorted by similarity score
```

### Query 2: Lookup Best Skill for Current Problem
```javascript
// Tech Lead: "What's the best approach for this?"
const skill = await skillRegistry.getBestMatch({
  type: 'refactor',
  domain: 'backend',
  complexity: 'high'
})
// Returns: skill-refactor-long-function with success_rate: 0.91
// Can show: "We've solved similar 91% success rate using this workflow"
```

### Query 3: Consolidate Semantic Memories
```javascript
// Weekly consolidation job
const newMemories = await consolidator.consolidateEpisodic()
// Processes 100+ experiences
// Returns: [mem-1, mem-2, mem-3] ready to add to MEMORY.md
// Example: "Large-File Refactoring: Split Before Review (confidence: 0.94)"
```

---

## Failure Modes & Recovery

### Failure Mode 1: Context Not Captured
**Scenario**: Subagent crashes; no context.outcome recorded  
**Recovery**: 
- Experience logger detects missing outcome (on next memory query)
- Falls back to git diff + commit message to infer outcome
- Records partial experience with "inferred_outcome: true"

### Failure Mode 2: Skill Registry Becomes Stale
**Scenario**: Skill success_rate drifts after 20+ uses  
**Recovery**:
- Weekly consolidation re-calculates success_rate from fresh experiences
- Promotes/demotes skills based on current data
- Marks old version as deprecated

### Failure Mode 3: Consolidation Loses Nuance
**Scenario**: Consolidator over-generalizes and loses important details  
**Recovery**:
- Original experiences are never deleted (preserved in experiences/ directory)
- Consolidation only adds to semantic memory; doesn't remove episodic
- Tech Lead can always revert MEMORY.md to previous version (git history)

### Failure Mode 4: Memory Corruption
**Scenario**: JSON files become corrupted  
**Recovery**:
- Metadata index includes content_hash for integrity checking
- Verification job detects corruption (weekly)
- Fallback: Rebuild from git history (experiences are append-only)

---

## Performance Characteristics

### Write Latency
| Operation | Latency | Batching |
|-----------|---------|----------|
| Create context | < 1ms | No |
| Record experience | < 5ms | Async queue (batch 10) |
| Update context outcome | < 1ms | No |
| Add to skill registry | < 2ms | Async (consolidation job) |

### Query Latency
| Operation | Latency | Caching |
|-----------|---------|---------|
| Lookup context by ID | < 5ms | Memory-cached |
| Find similar experiences | < 50ms | In-memory index |
| Get best skill | < 10ms | Sorted registry |
| Full semantic search | < 200ms | Lazy index build |

### Storage
| Component | Size (for 1000 tasks) |
|-----------|---|
| Contexts | ~100 MB (100 KB per context) |
| Experiences | ~200 MB (200 KB per experience) |
| Skills registry | ~2 MB (60 KB per skill) |
| Semantic memories | ~50 MB (consolidated from episodic) |
| **Total** | ~350 MB |

**Cleanup strategy**: Archive experiences older than 6 months (90%+ reduction after year 1)

---

## Integration Checklist

Before deploying Phase 1, verify:

- [ ] AGENTS.md updated with context frame standard
- [ ] Task template includes context_id reference
- [ ] No changes required to existing task implementations
- [ ] Context files are git-ignored (not committed)
- [ ] Metadata.json has version field for future migrations
- [ ] Directory structure matches schema above
- [ ] Read/write permissions verified on memory directories
- [ ] Backup strategy (weekly tar of memory/ directory)

For Phase 2+:
- [ ] Gemini service available for experience classification
- [ ] Consolidation job scheduled and tested
- [ ] MEMORY.md auto-population has Tech Lead review gate
- [ ] Skill metrics accurately reflect success/failure
- [ ] Deduplication verified to not lose information

---

## Next Steps

1. **Design Review**: Present this architecture to the team
2. **Prototype Phase 1**: Implement context frames in AGENTS.md
3. **Integration Test**: Run 10 tasks with context capture; verify zero regressions
4. **Feedback Loop**: Adjust schema based on real-world usage
5. **Phase 2 Kickoff**: Begin experience logging after Phase 1 stabilizes

---

**Document Status**: ✅ Ready for implementation  
**Last Updated**: 2026-04-07  
**Reviewers**: [TBD]
