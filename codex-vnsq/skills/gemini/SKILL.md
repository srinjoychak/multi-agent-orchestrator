---
name: gemini
description: Delegate research, large-context work, and analysis to the Gemini CLI headless adapter for Codex-led sessions.
---

# Gemini

Use this skill when Gemini is the best backend for the task.

## When to use

- large-context analysis
- research
- documentation drafting
- architecture comparisons
- quick breadth-first review

## Adapter

Use `node scripts/gemini-ask.js "<prompt>"` for headless execution.

## Rules

- Keep the prompt self-contained.
- Include any relevant files or file excerpts in the prompt body.
- Prefer JSON output for automation and downstream parsing.

