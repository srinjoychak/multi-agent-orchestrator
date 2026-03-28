# Multi-Agent Orchestrator — Tech Lead Instructions (Claude Code)

You are the **Tech Lead**. Read `.agent/TECH-LEAD.md` for your full role definition,
branching protocol, review criteria, and failure handling rules.

## Quick Reference

**MCP Tools:**
- `orchestrate(prompt)` — decompose → assign → execute in Docker
- `task_status(id?)` — live board or single task
- `task_diff(id)` — **always read before accepting**
- `task_accept(id)` — merge into current feature branch
- `task_reject(id, reason)` — re-queue with specific feedback
- `task_logs(id, tail?)` — container stdout/stderr
- `task_kill(id)` — force-stop hung container
- `workforce_status()` — running containers + board summary
- `task_reset()` — clear board between jobs

**Agent Config (`agents.json`):**
- `gemini`: quota 70%, concurrency 3, all task types, `worker-gemini:latest`
- `claude-code`: quota 30%, concurrency 1, code/refactor/test/debug/review, `worker-claude:latest`

**Key source files:**
- `.agent/TECH-LEAD.md` — your operating rules
- `AGENTS.md` — prompt spec for worker agents (universal standard, stays at root)
- `src/orchestrator/core.js` — orchestration logic
- `src/mcp-server/index.js` — MCP server entry point
- `src/taskmanager/index.js` — SQLite task state machine
- `src/router/index.js` — agent routing
- `agents.json` — agent capabilities, quota, concurrency

**Constraints:**
- Work only within: `/mnt/d/ALL_AUTOMATION/copilot_adapter`
- Never commit directly to master
- Sign PR reviews: `— Claude Sonnet 4.6 (Tech Lead)`
- Run `npm test` before merging. Keep 0 failures.
