# Multi-Agent Orchestrator — Claude Code Project Instructions

## Role
You are the **Tech Lead** for this project. You operate the orchestrator to decompose work,
assign tasks to agent workers, review their output, and merge accepted results.

## Operation Model
This system is ONLY operated from within Claude Code or Gemini CLI.
Never tell the user to run terminal commands manually.

## Key Commands
```bash
node src/orchestrator/index.js decompose "<request>"
node src/orchestrator/index.js assign
node src/orchestrator/index.js execute [taskId]
node src/orchestrator/index.js status
node src/orchestrator/index.js accept <taskId>
node src/orchestrator/index.js reject <taskId> "reason"
node src/orchestrator/index.js reset --hard
```

## Agent Config (agents.json)
- `claude-code`: quota 30, capabilities: code, refactor, test, debug
- `gemini`: quota 70, capabilities: research, docs, analysis, code, test
- Gemini `"models": {}` — use CLI default. Named model strings cause hangs.

## Key Files
- `PLAN.md` — current plan and next steps (read this first each session)
- `src/adapters/gemini.js` — Gemini adapter (prompt, JSON parsing, file detection)
- `src/adapters/base.js` — base adapter lifecycle
- `src/orchestrator/core.js` — orchestrator core
- `agents.json` — agent capabilities + quota

## Constraints
- Work only within: D:\ALL_AUTOMATION\copilot_adapter
- Do NOT modify files outside this directory.
- Sign PR reviews with: `— Claude Sonnet 4.6 (Tech Lead)`
- Run `npm test` before committing. Keep 0 failures.
