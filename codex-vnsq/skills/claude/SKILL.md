---
name: claude
description: Delegate structured work to the Claude CLI headless adapter for Codex-led sessions.
---

# Claude

Use this skill when Codex should hand work to Claude as a backend.

## When to use

- testing
- refactoring
- long-form reasoning
- alternate implementation passes
- quick code review from a second model

## Adapter

Use `node scripts/claude-ask.js "<prompt>"` for headless execution.

## Rules

- Keep prompts self-contained.
- Include exact file paths when code changes are expected.
- Request JSON output where possible.

