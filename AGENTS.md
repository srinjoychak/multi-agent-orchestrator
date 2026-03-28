# AGENTS.md — Agent Workforce Instruction Guide

This file defines how the orchestrator (and any Tech Lead) must structure tasks and prompts for each agent in the workforce. The goal is **zero supervision completion**: every agent must be able to read its prompt once, execute fully, commit, and report back — with no clarifying questions and no retry needed.

---

## Core Principle: Self-Contained Prompts

**Never assume the agent will find information on its own.**
Every prompt must contain everything the agent needs:
- What to build (full requirements, not a reference to another file)
- Where to build it (absolute file paths)
- How to verify it worked (completion checklist)
- How to commit and report when done

---

## Universal Rules (all agents)

1. **Embed the full task description** — not a pointer to it. The agent's working memory is only what's in the prompt.
2. **List every target file explicitly** with its absolute path inside the worktree (`/work/src/foo.js`, not `src/foo.js`).
3. **Non-interactive shell only** — never ask the agent to run `npm init`, `git init`, `npx create-*`, or any command that opens a prompt.
4. **Commit instruction is mandatory** — always end with: `git add -A && git commit -m "task: <id>"`. Agents that don't commit produce empty diffs and will be auto-retried as failures.
5. **Completion checklist** — tell the agent exactly what "done" looks like so it can self-verify before finishing.
6. **No placeholders or TODOs** — instruct agents to write all code fully. Partial implementations cause downstream failures.

---

## Standard Prompt Template

Use this structure for every task dispatched by the orchestrator:

```
# Task <id>: <title>

## Working Directory
/work   (absolute path inside the container)

## Files to Create or Modify
- /work/src/foo.js        (create — main module)
- /work/src/foo.test.js   (create — unit tests)

## Full Requirements
<paste the full description verbatim — no summarising>

## Instructions
- Implement all requirements completely. No placeholders, no TODOs.
- Use only non-interactive shell commands.
- Do NOT run: npm init, git init, npx create-*, or any interactive installer.
- After completing all files, run:
    git add -A && git commit -m "task: <id>"

## Completion Checklist (verify before committing)
- [ ] All files listed above exist and are fully implemented
- [ ] Code runs without syntax errors
- [ ] Tests pass (if applicable): node --test <testfile>
- [ ] git log shows a new commit for this task

## Reporting
After committing, summarise:
- What files were created or modified and what each does
- Any decisions or trade-offs made
- Confirmation that the git commit succeeded (include the commit hash)
```

---

## Agent-Specific Configuration

### Gemini (`worker-gemini:latest`)

**CLI invocation:**
```
gemini -p "<prompt>" --approval-mode yolo --output-format json
```

**Key behaviours (lab-verified v0.34.0):**
- Does NOT auto-scan the working directory. You must tell it explicitly what to read.
- Use `--approval-mode yolo` (not `-y`) — `-y` silently enables sandbox which breaks Docker-in-Docker.
- Use `--output-format json` — produces structured `{ session_id, response, stats }` output. The `stats.models` block contains per-model token counts.
- MCP servers in `settings.json` are loaded at startup — worker settings override must include `"mcpServers": {}` or gemini will try to connect to host MCP servers and pollute stdout.
- Stdin must be ignored/closed — open stdin pipes cause subprocess hangs.
- Gemini reports tool calls in JSON stats (`stats.tools.byName`) — useful for verifying it actually wrote files.

**Prompt additions for gemini:**
- Add a `## Reporting` section — gemini's verbose summary confirms it completed the task.
- Explicitly say "use the write_file tool" or "run shell command: git add -A && git commit" — gemini responds better to explicit tool instructions.
- Avoid long prompts with complex nested structure — gemini handles flat, sequential instructions better.

**Known issues:**
- `libsecret` warning on stderr — harmless, falls back to FileKeychain.
- `projects.json` ENOENT on stderr — harmless, non-fatal.
- MCP connection errors on stderr — harmless when worker settings has `"mcpServers": {}`.

---

### Claude Code (`worker-claude:latest`)

**CLI invocation:**
```
claude --print -p "<prompt>" --output-format json --dangerously-skip-permissions --no-session-persistence
```

**Key behaviours:**
- Reads the full prompt reliably. Full context in the prompt is essential.
- `--output-format json` returns `{ result, is_error, usage }`.
- `--dangerously-skip-permissions` skips all tool confirmation dialogs.
- `--no-session-persistence` prevents session state from leaking between tasks.
- Claude is better at multi-step reasoning and complex code tasks but has quota limits (30%).

**Prompt additions for claude:**
- Claude handles long, detailed prompts well — include full context without abbreviation.
- Explicitly include the worktree path and file list, same as gemini.

---

## Task Type → Agent Routing

| Task type | Preferred agent | Reason |
|-----------|----------------|--------|
| `research` | gemini | Free tier, large context window |
| `docs` | gemini | Free tier, strong writing |
| `analysis` | gemini | Free tier, reasoning |
| `code` | gemini (70%) / claude (30%) | Quota-weighted |
| `test` | gemini (70%) / claude (30%) | Quota-weighted |
| `refactor` | claude preferred | Precision edits, smaller blast radius |
| `debug` | claude preferred | Step-by-step reasoning |
| `review` | claude preferred | Judgment calls |

---

## What Causes Retry

The orchestrator auto-retries (up to `max_retries`) when:
- Exit code ≠ 0
- `parseOutput` returns `status: 'failed'`
- **Zero files changed on a `code`, `refactor`, `test`, or `docs` task** (silent failure guard)

On retry, a different agent is selected (round-robin by `previous_agents`). Design prompts so that a fresh agent with the same prompt can succeed independently — do not rely on state from a previous attempt.

---

## Tech Lead Checklist Before Dispatching

Before calling `orchestrate()`:

- [ ] Does the prompt include the full requirements (not a reference to another document)?
- [ ] Are all target file paths listed explicitly?
- [ ] Is the commit instruction present?
- [ ] Are interactive commands avoided?
- [ ] Is the completion checklist present so the agent can self-verify?
- [ ] For gemini: is the task small enough for one session? (>3000 token prompts may truncate)
- [ ] Is `max_retries` set appropriately? (default 1 — set to 2 for flaky external tasks)
