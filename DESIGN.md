# DESIGN.md — gemini-vnsq Implementation Review

> Topic: isolatedGeminiAuth security model, --dangerously-skip-permissions in claude-ask.js,
> hardcoded PACKAGE_TOOL path in deploy-gemini-squad.sh, spawnSync buffer cap,
> and skill design correctness across vn-plan/vn-argue/vn-dispatch

---

## Problem Statement

The `gemini-vnsq/` directory introduces a Gemini-native orchestration layer that mirrors
VN-Squad v2 (Claude-native). Five design areas carry meaningful risk that must be resolved
before the branch ships:

1. **isolatedGeminiAuth**: copies live OAuth credentials into a temp dir before every subprocess call.
2. **--dangerously-skip-permissions in claude-ask.js**: unconditionally grants Claude full filesystem access when called as a worker.
3. **Hardcoded PACKAGE_TOOL path in deploy-gemini-squad.sh**: ties the deploy script to a single machine's NVM layout.
4. **spawnSync 32MB buffer cap**: silently truncates large responses; no streaming fallback.
5. **Skill completeness**: `vn-argue` has no Codex-unavailability fallback; `vn-dispatch` has no defined process-tracking or result-merging protocol.

---

## Proposed Approach (Round 2 — responding to Codex findings)

### 1. isolatedGeminiAuth — REVISE (Codex finding: high)

**Codex position:** Copying live OAuth tokens is fundamentally unsafe; signal-handler cleanup
does not protect against SIGKILL or host crash; long-lived credentials can be exfiltrated.

**Claude response — CONCEDE on principle, DEFEND on mechanism:**

Codex is correct that the exposure window is not fully closable with signal handlers alone.
"Do not copy creds at all" is not immediately actionable without Gemini CLI supporting
per-process short-lived tokens (which it does not in the current API).

**Revised approach:**
- **Preferred path:** If `GEMINI_API_KEY` is set in the environment, pass it directly to the
  subprocess and skip the config-dir copy entirely. API key auth has a narrow, revocable scope
  and no session state that can be replayed.
- **Fallback (OAuth only):** If only OAuth is available, keep the copy pattern but:
  - Chmod the temp dir to `0700` immediately after `mkdtemp`.
  - Install `SIGINT`/`SIGTERM` handlers before `spawnSync`.
  - Add `process.on('exit', cleanup)` to catch non-signal exits.
  - Document explicitly: "Prefer `gemini auth --api-key` over OAuth to reduce credential
    footprint when using gemini-vnsq workers."
- **Out of scope for this PR:** Ephemeral per-run auth tokens require Gemini CLI API surface
  that does not yet exist. Track as a follow-up.

### 2. --dangerously-skip-permissions — REVISE (Codex finding: critical — AGREED)

`claude-ask.js:25` passes `--dangerously-skip-permissions` unconditionally. When Claude is
a headless worker, a prompt-injected or malicious task gets unrestricted filesystem and shell
access under the user's account.

**Agreed fix:**
```js
const unsafe = args.includes('--unsafe');
const permArgs = unsafe
  ? ['--dangerously-skip-permissions']
  : ['--allowedTools', 'Edit,Write,Bash,Glob,Grep,Read'];

const cliArgs = ['-p', prompt, '--output-format', 'json', '--bare', ...permArgs];
```

- Default: scoped tool allowlist sufficient for all implementation, test-writing, and docs tasks.
- `--unsafe`: explicit opt-in flag for callers that genuinely need full access.
- README must document: "worker subagents run in restricted mode by default."

### 3. Hardcoded PACKAGE_TOOL path — REJECT (Codex finding: high — AGREED)

**Agreed fix for `deploy-gemini-squad.sh`:**
```bash
PACKAGE_TOOL="$(npm root -g 2>/dev/null)/@google/gemini-cli/bundle/builtin/skill-creator/scripts/package_skill.cjs"

if [ ! -f "$PACKAGE_TOOL" ]; then
  echo "ERROR: Gemini skill packager not found at: $PACKAGE_TOOL"
  echo "Ensure @google/gemini-cli is installed globally: npm install -g @google/gemini-cli"
  exit 1
fi
```

Also validate that `gemini` CLI is on PATH before packaging.

### 4. spawnSync + 32MB buffer — REVISE (Codex finding: medium — PARTIAL AGREEMENT)

**Codex position:** Switch to streaming (`spawn`) with chunked handling.
**Claude position:** Full streaming rewrite is out of scope for this PR; the call pattern
(one blocking script call per background process) is intentional.

**Pragmatic fix agreed for this PR:**
```js
const MAX_BUFFER = 32 * 1024 * 1024;
const result = spawnSync('gemini', cliArgs, { ..., maxBuffer: MAX_BUFFER });

if (result.stdout && result.stdout.length >= MAX_BUFFER * 0.9) {
  process.stderr.write(
    `WARNING: output near 32MB buffer limit (${result.stdout.length} bytes). ` +
    `Response may be truncated. Consider splitting your prompt.\n`
  );
}
if (result.error?.code === 'ENOBUFS') {
  process.stderr.write('ERROR: output exceeded 32MB buffer. Prompt must be split.\n');
  process.exit(2);
}
```

Streaming refactor tracked as follow-up.

### 5. Skill Design — vn-argue and vn-dispatch (Codex finding: medium — AGREED)

**vn-argue failure handling (REVISE):**

Add to `vn-argue/SKILL.md` Step 3:
```
After running codex-ask.js:
  - If exit code != 0: STOP. Tell the user: "Codex unavailable — check codex-cli installation.
    Options: (1) retry after `codex login`, (2) proceed with Gemini self-critique."
  - If output cannot be parsed as JSON: STOP with the same message.
  - Never silently continue with a malformed review payload.
```

**vn-dispatch process tracking (REVISE):**

Replace the vague "monitor background processes" with a concrete protocol:
```
For each background task:
  - Generate TASK_ID=$(date +%s%N | md5sum | head -c 8)
  - Run: node <worker>.js ... > /tmp/vnsq-${TASK_ID}.json 2>&1
  - Record: echo "$TASK_ID  $AGENT  $DESCRIPTION" >> /tmp/vnsq-manifest.txt

Completion poll (every 5s, timeout 300s):
  - For each TASK_ID: check /tmp/vnsq-${TASK_ID}.json is non-empty and valid JSON
  - If any result missing or exitCode != 0: report failure per task
  - Run full test suite after all tasks complete
```

### 6. vn-plan — APPROVE AS-IS

TDD constraints are explicit and complete. Prohibited-content list prevents placeholder drift.

---

## Key Tradeoffs (Round 2)

| Decision | Status | Rationale |
|---|---|---|
| spawnSync + overflow warning | ACCEPT | Streaming refactor is follow-up; warning ships now |
| isolatedGeminiAuth: prefer API key, OAuth fallback + chmod 700 + SIGTERM | ACCEPT | Best available mitigation; ephemeral worker tokens not yet supported by Gemini CLI |
| Scoped allowlist + `--unsafe` opt-in | AGREED (both) | Correct trust model for subprocess workers |
| Dynamic PACKAGE_TOOL resolution | AGREED (both) | Required for portability |
| vn-argue hard-stop on Codex failure | AGREED (both) | Silent-continue is never safe in a debate loop |
| vn-dispatch temp-file manifest protocol | AGREED (both) | Deterministic; works with any shell background mechanism |

---

## Open Questions (Resolved)

1. **`gemini skills package` command?** — No stable CLI surface found. `npm root -g` resolution is the agreed workaround.
2. **`claude-ask.js` allowlist vs current use cases?** — Scoped allowlist covers all documented `/vn-dispatch` task types. `--unsafe` is the escape hatch.
3. **`vn-argue` fallback when Codex is unavailable?** — Hard stop with explicit user prompt. No silent self-critique (defeats the adversarial purpose).
4. **Portable `GEMINI_CONFIG_DIR` detection?** — Present from Gemini CLI 0.x onward; document minimum required version in README.

---

## Ship Checklist

- [ ] `claude-ask.js`: replace `--dangerously-skip-permissions` with allowlist + `--unsafe` flag
- [ ] `deploy-gemini-squad.sh`: dynamic PACKAGE_TOOL resolution with pre-flight validation
- [ ] `gemini-ask.js`: buffer overflow warning + ENOBUFS hard error; SIGTERM cleanup; chmod 700 tmpdir; prefer GEMINI_API_KEY path
- [ ] `vn-argue/SKILL.md`: add Codex-unavailability guard (Step 3)
- [ ] `vn-dispatch/SKILL.md`: add temp-file manifest protocol for result tracking
- [ ] `README.md`: document worker permission model and GEMINI_API_KEY preference
