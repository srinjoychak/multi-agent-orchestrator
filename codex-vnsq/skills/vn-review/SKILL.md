---
name: vn-review
description: Dispatch a structured code review after implementation and before merge.
---

# `vn-review` — Request Code Review

Request a structured code review with focused context to catch issues before they compound.

## Review focus

- correctness
- security
- regressions
- missing tests
- maintainability

## Prompt template

Ask the reviewer to:
- inspect `git diff <base>..<head>`
- categorize issues as Critical, Important, or Minor
- include file path, line number, description, suggested fix
- end with `APPROVE` or `REQUEST_CHANGES`
