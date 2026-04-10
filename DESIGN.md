# DESIGN.md — gemini-vnsq Implementation Review

> Topic: isolatedGeminiAuth security model, --dangerously-skip-permissions in claude-ask.js,
> hardcoded PACKAGE_TOOL path in deploy-gemini-squad.sh, spawnSync blocking for parallel
> dispatch, and skill design correctness across vn-plan/vn-argue/vn-dispatch

---

## Problem Statement

The `gemini-vnsq/` directory introduces a Gemini-native orchestration layer that mirrors
VN-Squad v2 (Claude-native). Five design areas carry meaningful risk that must be resolved
before the branch ships:

1. **isolatedGeminiAuth**: copies live OAuth credentials into a temp dir before every subprocess call.
2. **--dangerously-skip-permissions in claude-ask.js**: unconditionally grants Claude full filesystem access when called as a worker.
3. **Hardcoded PACKAGE_TOOL path in deploy-gemini-squad.sh**: ties the deploy script to a single machine's NVM layout.
4. **spawnSync for parallel dispatch**: blocks the Node.js event loop; defeats the stated parallelism goal in `/vn-dispatch`.
5. **Skill completeness**: `vn-argue` delegates to Codex for adversarial review but provides no fallback; `vn-plan` TDD constraints are well-specified; `vn-dispatch` lacks a result-merging step.

---

## Proposed Approach

### 1. isolatedGeminiAuth — ACCEPT WITH AMENDMENT

The intent (subprocess credential isolation) is correct. Gemini CLI reads `GEMINI_CONFIG_DIR`
and isolating credentials prevents one worker from polluting another's auth state.

**Risk:** temp dir holds live OAuth tokens. If cleanup() is skipped (e.g. process killed mid-run),
tokens persist until OS temp cleanup.

**Proposed fix:**
- Add a `SIGINT`/`SIGTERM` signal handler in gemini-ask.js that calls `cleanup()` before exit.
- Set `mode 0700` on the temp dir at creation (mkdtemp does not guarantee this).
- Document that the copied credentials are read-only replicas; workers cannot re-auth.

### 2. --dangerously-skip-permissions — REVISE

`claude-ask.js:25` passes `--dangerously-skip-permissions` unconditionally. This is appropriate
when Claude Code itself is the Tech Lead (it controls the session). It is **not** appropriate
when `claude-ask.js` is a subprocess worker called from Gemini.

A worker dispatched by `/vn-dispatch` may be handed an adversarial prompt (e.g. injected via
a file it reads). With `--dangerously-skip-permissions`, that worker has unrestricted FS access.

**Proposed fix:**
- Default to `--allowedTools Edit,Write,Bash,Glob,Grep` (sufficient for implementation tasks).
- Expose `--unsafe` flag in `claude-ask.js` so callers that genuinely need full access can opt in.
- Document the permission model in README.

### 3. Hardcoded PACKAGE_TOOL path — REJECT current approach

`deploy-gemini-squad.sh:18`:
```bash
PACKAGE_TOOL="/home/srinjcha/.nvm/versions/node/v24.14.0/lib/node_modules/@google/gemini-cli/bundle/builtin/skill-creator/scripts/package_skill.cjs"
```

This is a fully qualified path to a specific user's NVM layout. The script will fail for any
other developer (or if Node is upgraded). This is a critical portability regression.

**Proposed fix:**
- Use `$(npm root -g)/@google/gemini-cli/bundle/builtin/skill-creator/scripts/package_skill.cjs`
  as the resolution strategy.
- Add a pre-flight check: if the resolved path does not exist, print an actionable error and exit.
- Alternatively, if the Gemini CLI exposes a packaging command, prefer that over the internal CJS path.

### 4. spawnSync for parallel dispatch — REVISE

`gemini-ask.js`, `claude-ask.js`, and `codex-ask.js` all use `spawnSync`. This is correct for
a single sequential call (e.g. `/vn-gemini` or `/vn-argue`'s Codex review step).

It is **incompatible** with `/vn-dispatch`'s stated goal: "spawn a background shell process
with `is_background: true`". The SKILL.md for vn-dispatch correctly tells Gemini to use
background shells — the scripts themselves are only called one at a time, so `spawnSync` is
fine **if** each invocation is a separate background process.

The real risk is the `maxBuffer: 32MB` cap: a large Gemini response (e.g. full codebase diff)
will silently truncate. Use `spawn` + streaming instead, or at minimum log a warning when
`result.stdout.length` approaches the cap.

**Proposed fix:**
- Keep `spawnSync` for the simple case.
- Add a buffer-overflow guard: if `stdout.length >= maxBuffer * 0.9`, emit a warning to stderr.
- Document that true parallelism is achieved by the caller (Gemini) running multiple background
  processes, not by the scripts themselves.

### 5. Skill Design Correctness

**vn-plan** — Well-structured. TDD constraints (write failing test → verify fails → implement →
verify passes → commit) are explicit and complete. Prohibited content list prevents placeholder
drift. APPROVE as-is.

**vn-argue** — Critical gap: Step 4 calls `codex-ask.js` and expects structured JSON back,
but provides no fallback if Codex is unavailable or returns non-JSON output. The Claude-native
`/argue` skill handles this with an explicit guard ("If Codex is unavailable, STOP"). The
Gemini version does not. Additionally, the max rounds are 3 (Gemini skill) vs 4 (Claude skill) —
minor inconsistency but worth aligning.

**vn-dispatch** — The dispatch loop (Step 4) says "Read each agent's summary from the console
output" but does not specify how Gemini tracks background process IDs or waits for completion.
This is implementation-vague and will cause silent failures if an agent crashes mid-task.

---

## Key Tradeoffs

| Decision | Pro | Con |
|---|---|---|
| spawnSync per-script | Simple, synchronous, easy to test | 32MB buffer cap; no streaming |
| isolatedGeminiAuth copy | True auth isolation | Token exposure window if cleanup skipped |
| --dangerously-skip-permissions | Fewer permission prompts | Attack surface for prompt injection |
| Hardcoded PACKAGE_TOOL | Works on author's machine | Breaks on every other machine |
| Gemini as Tech Lead | Mirrors Claude-native pattern | Gemini cannot use Task tool natively; dispatch is shell-script-based |

---

## Open Questions

1. Does the Gemini CLI expose a stable `gemini skills package` command, or is `package_skill.cjs` the only path?
2. Can `claude-ask.js` default to a restricted allowlist without breaking any current `/vn-dispatch` use cases?
3. Should `vn-argue` (Gemini) hard-stop or fall back to a Gemini self-critique when Codex is unavailable?
4. Is there a portable way to detect `GEMINI_CONFIG_DIR` support across Gemini CLI versions?
