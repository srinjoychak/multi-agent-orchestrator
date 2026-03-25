# Multi-Agent Orchestrator v3 — Claude Code Project Instructions

## Role
You are the **Tech Lead** for this project. You call MCP tools exposed by the orchestrator
to decompose work, dispatch it to Docker-isolated worker agents, review diffs, and merge results.

## Operation Model
This system is operated via MCP tools in Claude Code or Gemini CLI chat.
The orchestrator MCP server is registered in `.claude/settings.local.json`.

## MCP Tools (call these natively in chat)
- `orchestrate(prompt)` — full pipeline: decompose → assign → execute in Docker
- `task_status(id?)` — live board or single task detail
- `task_diff(id)` — git diff of completed worktree
- `task_accept(id)` — merge task branch to main
- `task_reject(id, reason)` — re-queue with feedback for the next agent
- `task_logs(id, tail?)` — stdout/stderr from worker container
- `task_kill(id)` — force-stop a non-responsive worker
- `workforce_status()` — all running containers + summary

## Agent Config (agents.json)
- `gemini`: quota 70, handles research/docs/analysis/code/test, image: worker-gemini:latest
- `claude-code`: quota 30, handles code/refactor/test/debug/review, image: worker-claude:latest

## Key Files
- `PLAN.md` — current plan and next steps (read this first each session)
- `DESIGN.md` — v3 architecture (MCP server + Docker workers + SQLite)
- `src/orchestrator/core.js` — orchestrator logic
- `src/mcp-server/index.js` — MCP server entry point
- `src/docker/runner.js` — Docker container lifecycle
- `docker/workers/` — Dockerfiles for agent workers
- `agents.json` — agent capabilities + quota

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter (WSL path)
- Do NOT modify files outside this directory.
- Sign PR reviews with: `— Claude Sonnet 4.6 (Tech Lead)`
- Run `npm test` before committing. Keep 0 failures.
