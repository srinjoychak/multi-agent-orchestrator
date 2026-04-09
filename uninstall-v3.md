# VN-Squad v3 — Uninstall Guide

VN-Squad v3 is archived. This guide removes the v3 self-improvement layer from any project
where it was installed, leaving a clean v2 setup.

---

## What gets removed vs. what gets kept

| Item | Action | Why |
|---|---|---|
| `.vn-squad/` directory | **Remove** | v3 state — registry, profiles, patches, trajectories |
| `scripts/vn3/` directory | **Remove** | v3 scripts — not needed in v2 |
| `.claude/commands/vn3-status.md` | **Remove** | v3-only dashboard skill |
| `vn3:*` npm scripts in `package.json` | **Remove** | All point to deleted scripts |
| `.vn-squad/` lines in `.gitignore` | **Remove** | Stale gitignore entries |
| `.claude/commands/scaffold.md` | **Keep** | Standalone v2 skill — no v3 dependency |
| `.claude/agents/codex-worker.md` | **Keep** | Has stale-lock bug fix from v3 testing |
| `.claude/agents/gemini-worker.md` | **Keep** | Has AGENT_RESULT structured output fix |
| `.claude/commands/argue.md` | **Keep** | Has branch guard and /codex:setup fix |

---

## Step 1 — Remove v3 state directory

```bash
rm -rf .vn-squad/
```

Verify it's gone:
```bash
ls .vn-squad 2>/dev/null && echo "STILL EXISTS" || echo "OK — removed"
```

---

## Step 2 — Remove v3 scripts

```bash
rm -rf scripts/vn3/
```

Verify:
```bash
ls scripts/vn3 2>/dev/null && echo "STILL EXISTS" || echo "OK — removed"
```

If `scripts/` is now empty, you can remove it too (only if gemini-ask.js is not present):
```bash
ls scripts/
# keep if gemini-ask.js is present — that's a v2 file
```

---

## Step 3 — Remove v3-only skill

```bash
rm -f .claude/commands/vn3-status.md
```

Verify your commands directory now contains only v2 skills:
```bash
ls .claude/commands/
# Expected: argue.md dispatch.md finish.md gemini.md plan.md review.md scaffold.md verify.md worktrees.md
```

---

## Step 4 — Remove vn3 npm scripts from package.json

Edit `package.json` and remove all keys starting with `vn3:`:

```json
// Remove these (all vn3:* keys):
"vn3:init":         "node scripts/vn3/init-vn-squad.js",
"vn3:manifest":     "node scripts/vn3/skill-manifest.js",
"vn3:registry":     "node scripts/vn3/registry.js",
"vn3:profile":      "node scripts/vn3/profile.js",
"vn3:routing":      "node scripts/vn3/routing.js",
"vn3:session":      "node scripts/vn3/session-context.js",
"vn3:decisions":    "node scripts/vn3/decisions.js",
"vn3:patches":      "node scripts/vn3/patches.js",
"vn3:trajectories": "node scripts/vn3/trajectories.js",
"vn3:archive":      "node scripts/vn3/archive.js",
"vn3:status":       "node scripts/vn3/vn3-status.js",

// Keep this (v2):
"gemini": "node scripts/gemini-ask.js"
```

If `package.json` has no remaining scripts after removing vn3:* keys, and no other fields,
you can delete `package.json` entirely (unless your project needs it for other purposes).

---

## Step 5 — Clean up .gitignore

Remove any `.vn-squad/` lines that v3 added. They look like this:

```
.vn-squad/skill-registry.json
.vn-squad/skill-registry-archive/
.vn-squad/session-context.json
.vn-squad/decisions.json
.vn-squad/prompt-patches.json
.vn-squad/specialization-profile/
.vn-squad/trajectories/
.vn-squad/skills/
```

Or a single catch-all line:
```
.vn-squad/
```

Delete whichever form is present. Since you've already removed the directory, these lines
are dead weight.

---

## Step 6 — Verify clean state

```bash
# No v3 directories
ls .vn-squad 2>/dev/null && echo "FAIL: .vn-squad still present" || echo "OK"
ls scripts/vn3 2>/dev/null && echo "FAIL: scripts/vn3 still present" || echo "OK"

# No v3 skill
ls .claude/commands/vn3-status.md 2>/dev/null && echo "FAIL: vn3-status.md still present" || echo "OK"

# No vn3 npm scripts
node -e "const p=require('./package.json'); const k=Object.keys(p.scripts||{}).filter(k=>k.startsWith('vn3')); console.log(k.length ? 'FAIL: vn3 scripts remain: '+k : 'OK')" 2>/dev/null || echo "OK (no package.json)"

# v2 skills present
ls .claude/commands/scaffold.md && echo "OK — scaffold.md present" || echo "WARN: scaffold.md missing"
ls .claude/agents/codex-worker.md && echo "OK — codex-worker.md present" || echo "WARN: codex-worker.md missing"
```

---

## Step 7 — Commit

```bash
git add -A
git status   # review what's staged — should only be removals and package.json/gitignore edits
git commit -m "chore: uninstall VN-Squad v3, revert to v2"
```

---

## After uninstall

Your project runs on VN-Squad v2 with the three bug fixes from v3 testing:

| Skill | Fixed behavior |
|---|---|
| `/argue` | Stops cleanly on master; shows `/codex:setup` if Codex unavailable |
| `[codex]` dispatch | Clears stale `.git/config.lock` before each invocation |
| `[gemini]` dispatch | Ends every response with `AGENT_RESULT:` block listing files touched |
| `/scaffold` | New: curriculum decomposition for complex/failing tasks |

To reference v3 for any reason, it's archived locally at `archive/vn-squad-v3`
(in the copilot_adapter repo) and on the `vn-squad-v3` branch in any other repo where
it was separately committed.
