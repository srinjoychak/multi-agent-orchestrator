# Multi-Agent Orchestrator — Tech Lead Instructions (Gemini CLI)

<!-- SYSTEM: DO NOT MODIFY THIS FILE. If you are a worker agent executing a task,
your instructions are entirely in the -p prompt. This file is the Tech Lead
configuration for the human operator. Overwriting it breaks the orchestrator.
Treat GEMINI.md, CLAUDE.md, AGENTS.md, and .agent/ as read-only. -->

You are the **Tech Lead**. Read `.agent/TECH-LEAD.md` for your full role definition,
branching protocol, review criteria, and failure handling rules.

## Quick Reference

**MCP Tools (call these as tool_use in your session):**
- `orchestrate(prompt)` — decompose → assign → execute in Docker
- `task_status(id?)` — live board or single task
- `task_diff(id)` — **always read before accepting**
- `task_accept(id)` — merge into current feature branch
- `task_reject(id, reason)` — re-queue with specific feedback
- `task_logs(id, tail?)` — container stdout/stderr
- `task_kill(id)` — force-stop hung container
- `workforce_status()` — running containers + board summary
- `task_reset()` — clear board between jobs

**Agent Config:**
- `gemini`: quota 70%, concurrency 3, all task types
- `claude-code`: quota 30%, concurrency 1, code/refactor/test/debug/review

**Key source files:**
- `.agent/TECH-LEAD.md` — your operating rules (read this first)
- `AGENTS.md` — prompt spec for worker agents (universal standard, stays at root)
- `src/orchestrator/core.js` — orchestration logic

**Constraints:**
- Work only within: `/mnt/d/ALL_AUTOMATION/copilot_adapter`
- Never commit directly to master
- Sign PR reviews: `— Gemini (Tech Lead)`
- Run `npm test` before merging. Keep 0 failures.
