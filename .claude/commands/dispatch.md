# /dispatch — Parallel Agent Dispatch

*Sourced from obra/superpowers:dispatching-parallel-agents (skills.sh), extended with agent routing*

Delegate independent tasks to specialized agents working concurrently with isolated context.
By precisely crafting their instructions, agents stay focused and succeed without inheriting
your session history.

## Agent Routing Annotations

Prefix any task with `[agent]` to route it to a specific agent:

```
[claude]  implement fetch-data.js using the Node.js fetch API
[gemini]  research and document all fetch API options
[codex]   review fetch-data.js for security vulnerabilities
```

**Available agents:**

| Annotation | Routes to | Model flag |
|---|---|---|
| `[claude]` | Claude Code subagent (Task tool) | Use `/model opus\|sonnet` in CC session before dispatching |
| `[gemini]` | `scripts/gemini-ask.js` subprocess | Append `--model flash\|pro\|pro-exp` after the task |
| `[codex]` | codex-plugin-cc `/codex:rescue` | Append `--model <model>` after the task |

**Model examples:**
```
[gemini --model pro]  analyze the security implications of the auth middleware
[codex --model gpt-5.4-mini]  fix the failing unit test in auth.test.js
[claude]  implement the full authentication module
```

**No annotation = default routing by task type:**
- `research / docs / analysis` → gemini
- `code / refactor / test / debug` → claude-subagent
- `review / rescue / adversarial` → codex

## When to Use

**Use when:**
- 3+ independent tasks with different scopes
- Multiple subsystems need work simultaneously
- Each task can be understood without context from the others
- No shared state between tasks (they don't edit the same files)

**Don't use when:**
- Tasks are sequential (output of one feeds the next)
- Agents would edit the same files
- Full system context is required across all tasks

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

Create all tasks simultaneously. Each task runs in its own isolated context:
- `[claude]` tasks → Task tool subagents (parallel, same session model)
- `[gemini]` tasks → subprocess calls (parallel, model selectable)
- `[codex]` tasks → codex-plugin-cc (sequential — one at a time per JSON-RPC broker)

> **Codex concurrency note:** The codex-plugin-cc JSON-RPC broker handles one request at a
> time. Multiple `[codex]` tasks will queue automatically, not run in parallel.

### 4. Review and Integrate

- Read each agent's summary
- Verify fixes don't conflict (check overlapping files)
- Run the full test suite
- Integrate all changes

## Key Principle

**"Dispatch one agent per independent problem domain. Route by capability, not percentage."**

## Template for Each Agent Task

```
[agent] Task: [Name]

Working directory: [absolute path]
Files to create/modify:
  - [list with absolute paths]

Goal: [specific, measurable outcome]

Constraints:
  - Do NOT modify: [files outside scope]
  - Non-interactive shell only
  - After completing: git add -A && git commit -m "task: [name]"

Done when:
  - [ ] [specific verifiable checklist items]
  - [ ] git log shows new commit
```
