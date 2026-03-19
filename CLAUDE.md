# Multi-Agent Orchestrator — Project Instructions

## What This Project Is

A Node.js orchestrator that coordinates multiple AI coding CLI agents (Claude Code,
Gemini CLI) working as a team. Each agent operates through a standardized adapter,
works in an isolated git worktree, and communicates via file-based messaging.

## Architecture

- `src/orchestrator/` — Leader logic: decompose tasks, assign, monitor, merge
- `src/adapters/` — One adapter per CLI agent (base.js, claude-code.js, gemini.js)
- `src/taskmanager/` — Shared task list (tasks.json) with file locking
- `src/comms/` — Inter-agent communication (file-based for v1)
- `src/merger/` — Git branch merge + result aggregation
- `src/types/` — Shared schemas and type definitions
- `.agent-team/` — Runtime state directory (gitignored)

## Key Rules

1. **Adapters must implement the AgentAdapter interface** defined in `src/adapters/base.js`
2. **All task mutations go through TaskManager** — never write tasks.json directly
3. **Agents work in git worktrees** — never modify files in the main working directory
4. **Communication uses CommChannel interface** — never write to inbox directories directly
5. **File locking is mandatory** for any shared state mutation (tasks.json)

## CLI Invocation Patterns

```bash
# Claude Code (non-interactive, structured output)
claude -p "prompt here" --output-format json

# Gemini CLI (non-interactive, structured output)
gemini -p "prompt here" --output-format json
```

## Testing

Run tests with: `npm test`
Integration tests require both `claude` and `gemini` CLIs in PATH.

## Style

- ES modules (`import`/`export`)
- No TypeScript (plain JS with JSDoc types for v1)
- Minimal dependencies
- Errors should be descriptive and include context (which agent, which task)
