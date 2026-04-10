# DESIGN.md — gemini-vnsq Implementation Review

> Topic: isolatedGeminiAuth security model, --dangerously-skip-permissions in claude-ask.js,
> hardcoded PACKAGE_TOOL path in deploy-gemini-squad.sh, spawnSync buffer cap,
> and skill design correctness across vn-plan/vn-argue/vn-dispatch

---

## Problem Statement

The `gemini-vnsq/` directory introduces a Gemini-native orchestration layer that mirrors
VN-Squad v2 (Claude-native). Five design areas carry meaningful risk resolved across 3 debate
rounds before this branch ships.

---

## Agreed Design (Round 3 — final)

### 1. Worker Trust Boundary — `claude-ask.js` permissions

**History:**
- Round 1: flagged `--dangerously-skip-permissions` unconditional as critical risk.
- Round 2: proposed scoped allowlist `Edit,Write,Bash,Glob,Grep,Read` + `--unsafe` opt-in.
- Round 3 (Codex): Bash in the allowlist still allows arbitrary shell execution inside the
  worker, and pairing it with `GEMINI_API_KEY` in the subprocess env means a prompt-injected
  task can exfiltrate the bearer token via shell. Keeping Bash is not materially better than
  `--dangerously-skip-permissions` for credential-adjacent work.

**Agreed final fix:**
```js
const unsafe = args.includes('--unsafe');
const permArgs = unsafe
  ? ['--dangerously-skip-permissions']
  : ['--allowedTools', 'Edit,Write,Glob,Grep,Read'];  // Bash intentionally excluded
```

Bash is excluded from the default allowlist. If a task genuinely requires shell execution,
the caller must pass `--unsafe` explicitly. This is a deliberate opt-in, not an oversight.

**Credential handling for gemini-ask.js:**
- Pass `GEMINI_API_KEY` only when the API key auth path is used AND Bash is absent from the
  worker allowlist (i.e., the worker cannot execute shell commands to extract the key).
- When the OAuth copy path is used: `GEMINI_API_KEY` is NOT injected into the env. Chmod 700
  on tmpdir; SIGTERM handler; `process.on('exit', cleanup)`.
- Document: "Never combine Bash allowlist with long-lived credential injection."

### 2. Hardcoded PACKAGE_TOOL path — `deploy-gemini-squad.sh`

**Agreed fix (unchanged from Round 2):**
```bash
PACKAGE_TOOL="$(npm root -g 2>/dev/null)/@google/gemini-cli/bundle/builtin/skill-creator/scripts/package_skill.cjs"
if [ ! -f "$PACKAGE_TOOL" ]; then
  echo "ERROR: Gemini skill packager not found at: $PACKAGE_TOOL"
  echo "Ensure @google/gemini-cli is installed globally: npm install -g @google/gemini-cli"
  exit 1
fi
```

### 3. Dispatch Result Collection — `vn-dispatch/SKILL.md`

**History:**
- Round 2: proposed temp-file manifest writing stdout+stderr to a single `*.json` file.
- Round 3 (Codex): single mixed file breaks when worker emits diagnostic text; exit status
  is not independently recoverable; false failures on benign stderr.

**Agreed final protocol:**
```
Per task:
  - TASK_ID=$(date +%s%N | md5sum | head -c 8)
  - node <worker>.js ... \
      > /tmp/vnsq-${TASK_ID}.stdout.json \
      2> /tmp/vnsq-${TASK_ID}.stderr.log
  - echo $? > /tmp/vnsq-${TASK_ID}.exit
  - echo "$TASK_ID  $AGENT  $DESCRIPTION" >> /tmp/vnsq-manifest.txt

Completion poll (every 5s, timeout 300s):
  - For each TASK_ID: check .exit file exists and is non-empty
  - Read exit code from .exit; report failure if != 0
  - Read .stdout.json for machine-readable output
  - Read .stderr.log for diagnostics on failure
  - On any failure: stop dispatch, report which task failed with stderr log

Integration:
  - All exit codes == 0: read all summaries, run full test suite
  - Report per-task summary to Tech Lead
```

This separates machine-readable status from human-readable logs and preserves exit codes
even when a process dies before flushing output.

### 4. Buffer Overflow Handling — ALL THREE adapters

**History:**
- Round 2: proposed overflow warning + ENOBUFS error only for `gemini-ask.js`.
- Round 3 (Codex): same `spawnSync`/`maxBuffer` pattern exists in `claude-ask.js` and
  `codex-ask.js`; leaving them unguarded makes the fix inconsistent and the workflow
  still flaky for large Codex/Claude responses.

**Agreed final fix — apply uniformly to all three adapters:**
```js
const MAX_BUFFER = 32 * 1024 * 1024;
const result = spawnSync(binary, cliArgs, { ..., maxBuffer: MAX_BUFFER });

if (result.error?.code === 'ENOBUFS') {
  process.stderr.write(`ERROR: ${binary} output exceeded 32MB buffer. Split your prompt.\n`);
  process.exit(2);
}
if (result.stdout && result.stdout.length >= MAX_BUFFER * 0.9) {
  process.stderr.write(
    `WARNING: ${binary} output near 32MB limit (${result.stdout.length} bytes). ` +
    `Response may be truncated.\n`
  );
}
```

Applies to: `gemini-ask.js`, `claude-ask.js`, `codex-ask.js`.

### 5. vn-argue — Codex Unavailability Guard

**Agreed fix:** Add explicit guard to `vn-argue/SKILL.md` Step 3:
```
After running codex-ask.js:
  - If exit code != 0: STOP. "Codex unavailable — options: (1) codex login, (2) Gemini self-critique."
  - If output cannot be parsed as JSON: STOP with the same message.
  - Never silently continue with a malformed review payload.
```

### 6. vn-plan — APPROVED AS-IS

---

## Key Tradeoffs (Final)

| Decision | Status | Rationale |
|---|---|---|
| Bash excluded from default worker allowlist | AGREED | Combining shell access + long-lived creds is not materially safer than full permissions |
| GEMINI_API_KEY not injected when Bash is unavailable? | AGREED | API key can only be exfiltrated via shell; no shell = safe to inject |
| spawnSync overflow handling on all 3 adapters | AGREED | Uniform transport contract; no partial protection |
| Per-task exit + stdout + stderr separate files | AGREED | Machine-readable status survives mixed output and premature exit |
| Dynamic PACKAGE_TOOL resolution | AGREED | Portability blocker; must be fixed before merge |
| vn-argue hard-stop on Codex failure | AGREED | Adversarial loop must never silently proceed |

---

## Ship Checklist

- [ ] `claude-ask.js`: remove `--dangerously-skip-permissions`; default allowlist = `Edit,Write,Glob,Grep,Read` (no Bash); `--unsafe` opt-in
- [ ] `gemini-ask.js`: chmod 700 tmpdir; SIGTERM + exit handler; buffer overflow guard (uniform with other adapters); do NOT inject GEMINI_API_KEY when Bash is allowed
- [ ] `claude-ask.js` + `codex-ask.js`: add same buffer overflow guard (ENOBUFS hard error + 90% warning)
- [ ] `deploy-gemini-squad.sh`: dynamic PACKAGE_TOOL with pre-flight validation
- [ ] `vn-argue/SKILL.md`: Codex-unavailability guard (Step 3)
- [ ] `vn-dispatch/SKILL.md`: per-task 3-file protocol (.stdout.json, .stderr.log, .exit)
- [ ] `README.md`: document permission model, GEMINI_API_KEY preference, minimum Gemini CLI version
