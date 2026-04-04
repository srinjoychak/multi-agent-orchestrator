# /dispatch — Parallel Agent Dispatch

*Sourced from obra/superpowers:dispatching-parallel-agents (skills.sh)*

Delegate independent tasks to specialized agents working concurrently with isolated context.
By precisely crafting their instructions, agents stay focused and succeed without inheriting
your session history.

## When to Use

**Use when:**
- 3+ independent tasks with different scopes
- Multiple subsystems need work simultaneously
- Each task can be understood without context from the others
- No shared state between tasks

**Don't use when:**
- Tasks are sequential (output of one feeds the next)
- Agents would edit the same files
- Full system context is required for all tasks

## The Pattern

### 1. Identify Independent Domains

Group tasks by what they touch. Each domain is independent — fixing one doesn't affect others.

### 2. Create Focused Agent Tasks

Each agent receives exactly:
- **Scope**: Which files/subsystem, nothing else
- **Goal**: Specific outcome (e.g. "make these tests pass")
- **Constraints**: What NOT to change
- **Expected output**: What "done" looks like + how to report

Agents must NEVER inherit your session context or history.
Construct exactly what they need — no more, no less.

### 3. Dispatch in Parallel

Create all tasks simultaneously using the Task tool.
Each task runs in its own subagent context.

### 4. Review and Integrate

- Read each agent's summary
- Verify fixes don't conflict (check overlapping files)
- Run the full test suite
- Integrate all changes

## Key Principle

**"Dispatch one agent per independent problem domain. Let them work concurrently."**

## Template for Each Agent Task

```
## Task: [Name]

**Working directory:** [absolute path]

**Scope:** [exactly what this agent should touch]

**Goal:** [specific, measurable outcome]

**Files to create/modify:**
- [list with absolute paths]

**Constraints:**
- Do NOT modify: [list files outside scope]
- Non-interactive shell only
- After completing: git add -A && git commit -m "task: [name]"

**Done when:**
- [ ] [specific verifiable checklist items]
- [ ] git log shows new commit
```
