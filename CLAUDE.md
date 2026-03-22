# Task Context — PLAN

**Agent:** claude-code
**Task:** Decompose user request into tasks
**Branch:** main

## Objective
You are a senior engineering team lead. Decompose the following request into
a list of discrete, parallelizable tasks for a team of AI coding agents.

RULES:
1. Return ONLY a valid JSON array — no prose, no markdown, no explanation.
2. Each task must be completable by one agent working alone in its own directory.
3. Tasks must NOT touch the same files — zero overlap in scope.
4. Express dependencies via "depends_on": ["T1"] — only block when truly necessary.
5. Each task must have a "type" field — choose ONE from:
   code, refactor, test, review, debug, research, docs, analysis
6. Keep tasks granular — max one concern per task.

OUTPUT SCHEMA (strict):
[
  {
    "id": "T1",
    "title": "Short imperative title (max 60 chars)",
    "description": "Detailed description of exactly what to do and where",
    "type": "code",
    "depends_on": []
  }
]

EXAMPLE for "add user auth to the API":
[
  {"id":"T1","title":"Add JWT auth middleware","description":"Create src/middleware/auth.js with JWT verify logic using jsonwebtoken","type":"code","depends_on":[]},
  {"id":"T2","title":"Protect API routes","description":"Update src/routes/*.js to apply auth middleware to all protected endpoints","type":"refactor","depends_on":["T1"]},
  {"id":"T3","title":"Write auth middleware tests","description":"Create tests/auth.test.js covering valid token, expired token, missing token cases","type":"test","depends_on":["T1"]}
]

REQUEST: Write a file called docs/gemini-verified.md containing a markdown table comparing Jest, Vitest, and Node's built-in test runner across: speed, zero-config setup, and TypeScript support. Use your own knowledge — no web search needed.

## Constraints
- Work only within: D:\ALL_AUTOMATION\copilot_adapter
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.