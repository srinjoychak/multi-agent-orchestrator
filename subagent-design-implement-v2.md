# Vendor-Agnostic Subagent Platform v2 - Token Efficiency Plan

> **Status:** Draft for implementation.
> **Goal:** Improve token efficiency without losing vendor neutrality, isolation, or reviewability.

---

## Why This Exists

The current host-led subagent platform is operationally strong:
- vendor-neutral provider routing
- isolated git worktrees
- Docker sandboxing
- SQLite task state
- merge/review/accept flow
- delegation depth and recovery

The next optimization target is **token efficiency**. The platform should spend model tokens where they matter and avoid repeated or redundant context.

This plan focuses on five high-impact changes:
1. Route by task size, not only task type
2. Shrink worker prompts aggressively
3. Deduplicate shared context across workers
4. Reduce merge/retry churn
5. Make research outputs structured and reusable

---

## Slice 1 - Task Size Routing

### Goal

Route tasks by **size** as well as capability so the orchestrator can choose the cheapest sufficient model.

### New behavior

Every task receives a size label:
- `small`
- `medium`
- `large`

Routing uses:
- task type
- file count
- diff size
- prompt length
- dependency fan-out
- expected edit complexity

### Proposed policy

- `small` tasks:
  - use cheaper/faster providers by default
  - prefer the provider with lowest token cost among capable providers
- `medium` tasks:
  - use normal role-based routing
- `large` tasks:
  - use the strongest capable provider or the configured preferred provider

### Files likely involved

- `src/router/index.js`
- `src/orchestrator/core.js`
- `src/taskmanager/index.js`
- `src/types/index.js`
- `agents.json`

### Acceptance criteria

- Tasks can be classified as `small`, `medium`, or `large`
- Router can select providers differently based on size
- Small tasks do not always default to the most expensive capable model
- Routing reason includes size-based decision data

### Validation plan

- Unit tests for task sizing heuristics
- Router tests covering size-aware selection
- Integration test confirming small tasks prefer cheaper providers when available

### Definition of done

- Task size is persisted on the task record
- Size-aware routing is active
- Existing routing behavior still works for tasks without size metadata

---

## Slice 2 - Prompt Minimization

### Goal

Reduce the token cost of every worker invocation by sending only the minimum useful context.

### New behavior

The orchestrator should build prompts from:
- exact task instructions
- exact file list
- only the relevant file excerpts
- short repo summary
- hard constraints

Avoid:
- full repo dumps
- repeated architecture narrative
- duplicated instructions
- unnecessary README-style context

### Proposed implementation

Add a context builder that assembles:
- task-specific prompt body
- selected file snippets
- compact project summary cache
- provider-specific wrapper if needed

### Files likely involved

- `src/orchestrator/core.js`
- `src/context/index.js` or similar new module
- `src/context/*.test.js`
- `src/mcp-server/tools.js`

### Acceptance criteria

- Worker prompts are shorter for small and medium tasks
- Relevant file context is included only when needed
- Prompt construction remains deterministic
- No task loses required instruction fidelity

### Validation plan

- Snapshot tests for prompt shape
- Unit tests for context selection
- Integration tests ensuring worker prompts still contain required task details

### Definition of done

- Context assembly is centralized
- Prompt length drops for typical tasks
- All current task outcomes remain stable

---

## Slice 3 - Shared Context Cache

### Goal

Stop recomputing the same project summary for every worker.

### New behavior

The system should cache reusable context objects such as:
- repo summary
- package/runtime summary
- file map
- architecture notes
- common task templates

These can be reused across tasks in the same job or session.

### Proposed cache scopes

- per job
- per repository revision
- per session

### Files likely involved

- `src/orchestrator/core.js`
- `src/taskmanager/index.js`
- `src/cache/index.js` or similar new module
- `src/cache/*.test.js`

### Acceptance criteria

- Reused context is identical across tasks when the repo state has not changed
- Cache invalidates on repo change or task scope change
- Cache hits reduce repeated prompt-building work

### Validation plan

- Unit tests for cache keying and invalidation
- Integration test showing multiple tasks reuse the same cached summary

### Definition of done

- Shared context exists and is used by the orchestrator
- Cache invalidation is deterministic
- No stale context is served after repo changes

---

## Slice 4 - Merge and Retry Churn Reduction

### Goal

Reduce wasted tokens caused by retries, merge conflicts, and over-broad task slices.

### New behavior

Improve task decomposition and routing so each worker:
- touches fewer files
- has clearer scope
- is less likely to conflict
- is less likely to need a rerun

Add retry intelligence:
- prefer alternate provider on retry
- keep prior failure reason in routing metadata
- avoid reassigning a task to an already-tried provider unless required

### Files likely involved

- `src/orchestrator/core.js`
- `src/router/index.js`
- `src/taskmanager/index.js`
- `src/worktree/index.js` if merge behavior needs tighter metadata
- `tests/integration/*.test.js`

### Acceptance criteria

- Retries rotate providers when possible
- Decomposition avoids file overlap more aggressively
- Merge conflicts are surfaced early and clearly
- The system avoids pointless reruns on the same provider if alternatives exist

### Validation plan

- Tests for retry-to-different-provider behavior
- Tests for dependency-aware task slicing
- Merge conflict regression tests

### Definition of done

- Retry routing is provider-aware
- Merge churn is measurably lower in representative jobs
- Task decomposition produces cleaner boundaries

---

## Slice 5 - Structured Research Outputs

### Goal

Make research and analysis tasks produce reusable artifacts instead of raw prose only.

### New behavior

Research tasks should return structured output with fields like:
- summary
- key findings
- relevant files
- risks
- follow-up actions
- confidence

That output should be persisted and available to downstream tasks.

### Files likely involved

- `src/orchestrator/core.js`
- `src/taskmanager/index.js`
- `src/types/index.js`
- `src/mcp-server/tools.js`
- `tests/integration/*.test.js`

### Acceptance criteria

- Research outputs are persisted in a structured format
- Downstream tasks can read and reuse the output
- Summary content remains human-readable

### Validation plan

- Parser tests for structured research envelopes
- Integration test where implementation task consumes a prior research task result

### Definition of done

- Research output is no longer throwaway text
- Reuse of prior research reduces duplicate reading and token spend

---

## Slice 6 - Observability for Token Usage

### Goal

Make token spend visible enough to improve routing decisions.

### New behavior

Track:
- provider
- model
- task size
- input tokens
- output tokens
- duration
- retry count
- merge outcome

Use this data to refine routing and detect expensive patterns.

### Files likely involved

- `src/taskmanager/index.js`
- `src/orchestrator/core.js`
- `src/mcp-server/tools.js`
- `src/logger/index.js` if logging needs enrichment

### Acceptance criteria

- Task records retain token usage metadata
- Workload reporting can surface expensive tasks
- Routing decisions can use historical spend data later

### Validation plan

- Unit tests for persisted token metadata
- Status and diff output includes useful spend context

### Definition of done

- Token usage is visible at task and workforce level
- The data is available for later routing optimization

---

## Recommended Build Order

1. Task size routing
2. Prompt minimization
3. Shared context cache
4. Merge and retry churn reduction
5. Structured research outputs
6. Token usage observability

---

## Definition of Success

The platform is better when it:
- spends fewer tokens on small tasks
- reuses context instead of regenerating it
- routes expensive models only when needed
- reduces repeated work on retries and merges
- turns research into reusable project knowledge

The end state is a system that is still vendor-neutral and controlled, but materially cheaper to operate.

