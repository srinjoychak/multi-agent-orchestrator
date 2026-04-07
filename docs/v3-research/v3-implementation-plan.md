# VN-Squad v3 Implementation Plan

> **For agentic workers:** Use /dispatch for parallel task execution. Each task is self-contained.

**Goal:** Add a self-improving persistence layer to VN-Squad v2 via plain JSON files in `.vn-squad/` — no daemons, no new runtime dependencies.

**Architecture:** Nine Node.js ESM scripts in `scripts/vn3/` implement atomic JSON operations (init, registry append, profile recompute, session context, archive migration, skill manifest, routing decisions, patch lifecycle, trajectory capture). Two new skills (scaffold, vn3-status) expose these to the Tech Lead. AGENTS.md gains CONTEXT_PROPOSAL and quality_signals protocol fields.

**Tech Stack:** Node.js ESM (v24), plain JSON files, POSIX atomic rename (mv), crypto.randomUUID(), existing gemini-ask.js pattern.

---

## Dispatch Groups (parallelizable)

```
GROUP A (independent — run first):
  Task 1: scripts/vn3/init-vn-squad.js   [claude]
  Task 2: scripts/vn3/skill-manifest.js  [gemini]
  Task 3: scripts/vn3/registry.js        [codex]
  Task 4: Config updates (AGENTS.md, .gitignore, package.json, agents.json)  [gemini]

GROUP B (depends on Task 1+3 schemas — run after GROUP A):
  Task 5: scripts/vn3/profile.js + routing.js   [claude]
  Task 6: scripts/vn3/session-context.js + archive.js  [gemini]
  Task 7: scripts/vn3/patches.js + trajectories.js  [codex]

GROUP C (depends on GROUP B — run last):
  Task 8: .claude/commands/scaffold.md + vn3-status.md  [claude]
```

---

## Task 1: Init Script — `.vn-squad/` Bootstrap

**Files:**
- Create: `scripts/vn3/init-vn-squad.js`
- Create: (initializes all `.vn-squad/` artifacts)

- [ ] **Step 1: Write the failing test**
```bash
# Run before implementation — should exit non-zero or produce no .vn-squad/
node scripts/vn3/init-vn-squad.js 2>&1 | head -5 || true
ls .vn-squad/ 2>&1 || echo "FAIL: directory missing"
```
Expected: `FAIL: directory missing` or script not found error

- [ ] **Step 2: Implement `scripts/vn3/init-vn-squad.js`**
```javascript
#!/usr/bin/env node
// scripts/vn3/init-vn-squad.js
// Idempotent bootstrap: creates .vn-squad/ and all v3 JSON artifacts if missing.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const VN3 = join(ROOT, '.vn-squad');
const ARCHIVE = join(VN3, 'skill-registry-archive');
const TRAJECTORIES = join(VN3, 'trajectories');
const SKILLS = join(VN3, 'skills');
const PROFILES = join(VN3, 'specialization-profile');

function ensureDir(p) {
  if (!existsSync(p)) { mkdirSync(p, { recursive: true }); console.log(`created ${p}`); }
}

function writeIfMissing(p, data) {
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
    console.log(`created ${p}`);
  } else {
    console.log(`exists  ${p}`);
  }
}

function getBranch() {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

// Ensure directories
[VN3, ARCHIVE, TRAJECTORIES, SKILLS, PROFILES].forEach(ensureDir);

const now = new Date().toISOString();

// skill-registry.json
writeIfMissing(join(VN3, 'skill-registry.json'), {
  schema_version: 1,
  entries: []
});

// decisions.json
writeIfMissing(join(VN3, 'decisions.json'), {
  schema_version: 1,
  entries: []
});

// session-context.json
writeIfMissing(join(VN3, 'session-context.json'), {
  schema_version: 1,
  session_id: randomUUID(),
  branch: getBranch(),
  created_at: now,
  seeded_from_trajectory: null,
  conventions: {},
  rejected_keys: [],
  pending_proposals: [],
  completed_tasks: []
});

// prompt-patches.json
writeIfMissing(join(VN3, 'prompt-patches.json'), {
  schema_version: 1,
  patches: []
});

// specialization-profile/gemini-worker.json
writeIfMissing(join(PROFILES, 'gemini-worker.json'), {
  agent: 'gemini-worker',
  last_recomputed_at: now,
  registry_entry_count_at_recompute: 0,
  strengths: [],
  weaknesses: [],
  constraints: []
});

// specialization-profile/codex-worker.json
writeIfMissing(join(PROFILES, 'codex-worker.json'), {
  agent: 'codex-worker',
  last_recomputed_at: now,
  registry_entry_count_at_recompute: 0,
  strengths: [],
  weaknesses: [],
  constraints: []
});

// specialization-profile/claude-subagent.json
writeIfMissing(join(PROFILES, 'claude-subagent.json'), {
  agent: 'claude-subagent',
  last_recomputed_at: now,
  registry_entry_count_at_recompute: 0,
  strengths: [],
  weaknesses: [],
  constraints: []
});

console.log('\n✓ .vn-squad/ initialized');
```

- [ ] **Step 3: Verify**
```bash
node scripts/vn3/init-vn-squad.js
```
Expected output contains: `✓ .vn-squad/ initialized`
```bash
ls .vn-squad/
```
Expected: `decisions.json  prompt-patches.json  session-context.json  skill-registry.json  skill-registry-archive  skills  specialization-profile  trajectories`

- [ ] **Step 4: Verify idempotency**
```bash
node scripts/vn3/init-vn-squad.js
```
Expected: all lines say `exists  .vn-squad/...` — no errors, no duplicate creates.

- [ ] **Step 5: Commit**
```bash
git add scripts/vn3/init-vn-squad.js && git commit -m "feat(vn3): init script bootstraps .vn-squad/ artifacts"
```

---

## Task 2: Skill Manifest Generator

**Files:**
- Create: `scripts/vn3/skill-manifest.js`

- [ ] **Step 1: Write failing test**
```bash
node scripts/vn3/skill-manifest.js 2>&1 || echo "FAIL: script missing"
```
Expected: script not found error

- [ ] **Step 2: Implement `scripts/vn3/skill-manifest.js`**
```javascript
#!/usr/bin/env node
// scripts/vn3/skill-manifest.js
// Scans .claude/commands/ and writes .vn-squad/skill-manifest.json
// Safe to run any time — fully idempotent.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const COMMANDS_DIR = join(ROOT, '.claude', 'commands');
const VN3_DIR = join(ROOT, '.vn-squad');
const MANIFEST_PATH = join(VN3_DIR, 'skill-manifest.json');

if (!existsSync(VN3_DIR)) mkdirSync(VN3_DIR, { recursive: true });

const CATEGORY_MAP = {
  argue: 'design', dispatch: 'orchestration', finish: 'lifecycle',
  gemini: 'execution', plan: 'planning', review: 'quality',
  verify: 'quality', worktrees: 'orchestration',
  scaffold: 'planning', 'vn3-status': 'observability'
};

const TAG_MAP = {
  argue: ['design', 'debate', 'codex'], dispatch: ['parallel', 'agents', 'orchestration'],
  finish: ['merge', 'pr', 'lifecycle'], gemini: ['gemini', 'research', 'large-context'],
  plan: ['tdd', 'planning', 'decompose'], review: ['review', 'quality'],
  verify: ['verify', 'gate', 'green'], worktrees: ['git', 'isolation'],
  scaffold: ['curriculum', 'tiered', 'planning'], 'vn3-status': ['v3', 'status', 'observability']
};

function extractDescription(content) {
  // First H1 heading or first non-empty line after front matter
  const lines = content.split('\n');
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) return h1[1].trim();
  }
  return 'No description';
}

const files = readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'));
const skills = files.map(f => {
  const name = basename(f, '.md');
  const content = readFileSync(join(COMMANDS_DIR, f), 'utf8');
  return {
    name,
    file: `.claude/commands/${f}`,
    description: extractDescription(content),
    category: CATEGORY_MAP[name] || 'general',
    tags: TAG_MAP[name] || [name]
  };
});

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  skills
};

// Atomic write
const tmp = join(tmpdir(), `skill-manifest-${Date.now()}.json`);
writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
execSync(`mv "${tmp}" "${MANIFEST_PATH}"`);

console.log(`✓ skill-manifest.json — ${skills.length} skills indexed`);
skills.forEach(s => console.log(`  ${s.name.padEnd(16)} [${s.category}]  ${s.description.slice(0, 60)}`));
```

- [ ] **Step 3: Verify**
```bash
node scripts/vn3/skill-manifest.js
```
Expected: `✓ skill-manifest.json — N skills indexed` (N = count of .md files in .claude/commands/)
```bash
node -e "const m=JSON.parse(require('fs').readFileSync('.vn-squad/skill-manifest.json')); console.log(m.skills.map(s=>s.name).join(', '))"
```
Expected: `argue, dispatch, finish, gemini, plan, review, verify, worktrees` (at minimum)

- [ ] **Step 4: Commit**
```bash
git add scripts/vn3/skill-manifest.js && git commit -m "feat(vn3): skill-manifest generator indexes .claude/commands/"
```

---

## Task 3: Registry — Atomic Append

**Files:**
- Create: `scripts/vn3/registry.js`

- [ ] **Step 1: Write failing test**
```bash
node -e "import('./scripts/vn3/registry.js').then(m => m.appendEntry({agent:'test',task_type:'code',outcome:'success',failure_code:'none'})).catch(e => console.error('FAIL:', e.message))" 2>&1
```
Expected: `FAIL: Cannot find module` or similar

- [ ] **Step 2: Implement `scripts/vn3/registry.js`**
```javascript
// scripts/vn3/registry.js
// Atomic append to .vn-squad/skill-registry.json

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, '.vn-squad', 'skill-registry.json');

const VALID_TASK_TYPES = new Set(['code','test','research','docs','debug','refactor','review']);
const VALID_FAILURE_CODES = new Set(['EmptyDiff','CompileRed','TestFail','StaleBranch','PromptMisdelivery','ProviderFailure','none']);

function getCurrentBranch() {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function getHeadCommit() {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function readRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return { schema_version: 1, entries: [] };
  }
  try {
    const data = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    if (data.schema_version !== 1) throw new Error('schema_version mismatch');
    return data;
  } catch (e) {
    // Corruption recovery: rename to .bak, reinitialize
    execSync(`mv "${REGISTRY_PATH}" "${REGISTRY_PATH}.bak"`);
    console.warn(`⚠ skill-registry.json corrupted — renamed to .bak, reinitializing`);
    return { schema_version: 1, entries: [] };
  }
}

/**
 * Append a dispatch outcome entry to skill-registry.json (atomic write).
 * @param {object} entry - Dispatch outcome fields
 */
export function appendEntry(entry) {
  const task_type = entry.task_type;
  const failure_code = entry.failure_code || 'none';

  if (!VALID_TASK_TYPES.has(task_type)) {
    throw new Error(`Invalid task_type: ${task_type}. Must be one of: ${[...VALID_TASK_TYPES].join(', ')}`);
  }
  if (!VALID_FAILURE_CODES.has(failure_code)) {
    console.warn(`Unknown failure_code "${failure_code}" — normalized to "none"`);
  }

  const registry = readRegistry();
  const fullEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    branch: getCurrentBranch(),
    head_commit: getHeadCommit(),
    skill: entry.skill || '/dispatch',
    agent: entry.agent,
    model: entry.model || null,
    task_type,
    outcome: entry.outcome,
    failure_code: VALID_FAILURE_CODES.has(failure_code) ? failure_code : 'none',
    recovery_used: entry.recovery_used || null,
    recovery_outcome: entry.recovery_outcome || null,
    quality_signals: {
      review_verdict: entry.quality_signals?.review_verdict || null,
      files_changed: entry.quality_signals?.files_changed ?? null,
      test_coverage: entry.quality_signals?.test_coverage || null
    }
  };

  registry.entries.push(fullEntry);

  // Atomic write via tmp + rename
  const tmp = join(tmpdir(), `skill-registry-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n');
  execSync(`mv "${tmp}" "${REGISTRY_PATH}"`);

  return fullEntry;
}

/**
 * Read all active registry entries (last 6 months by default).
 * @param {boolean} allEntries - If true, return all entries regardless of age
 */
export function readEntries(allEntries = false) {
  const registry = readRegistry();
  if (allEntries) return registry.entries;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  return registry.entries.filter(e => new Date(e.timestamp) >= cutoff);
}

// CLI usage: node scripts/vn3/registry.js --append '{"agent":"gemini-worker","task_type":"code","outcome":"success","failure_code":"none"}'
if (process.argv[2] === '--append') {
  const entry = JSON.parse(process.argv[3]);
  const result = appendEntry(entry);
  console.log('✓ appended:', result.id);
} else if (process.argv[2] === '--list') {
  const entries = readEntries();
  console.log(`${entries.length} active entries (last 6 months)`);
  entries.slice(-5).forEach(e => console.log(`  ${e.timestamp.slice(0,10)} ${e.agent} ${e.task_type} → ${e.outcome}`));
}
```

- [ ] **Step 3: Verify**
```bash
node scripts/vn3/registry.js --append '{"agent":"gemini-worker","task_type":"code","outcome":"success","failure_code":"none","quality_signals":{"review_verdict":"APPROVE","files_changed":3}}'
```
Expected: `✓ appended: <uuid>`
```bash
node scripts/vn3/registry.js --list
```
Expected: `1 active entries (last 6 months)` + one line showing the entry

- [ ] **Step 4: Test invalid task_type**
```bash
node -e "import('./scripts/vn3/registry.js').then(m => m.appendEntry({agent:'test',task_type:'invalid',outcome:'success',failure_code:'none'})).catch(e => console.log('CORRECT ERROR:', e.message))"
```
Expected: `CORRECT ERROR: Invalid task_type: invalid...`

- [ ] **Step 5: Commit**
```bash
git add scripts/vn3/registry.js && git commit -m "feat(vn3): registry.js atomic append to skill-registry.json with schema validation"
```

---

## Task 4: Config Updates (AGENTS.md, .gitignore, package.json, agents.json)

**Files:**
- Modify: `AGENTS.md` — add CONTEXT_PROPOSAL + quality_signals protocol
- Modify: `.gitignore` — add .vn-squad/ exclusions
- Modify: `package.json` — add vn3 npm scripts
- Modify: `agents.json` — document vn3 scripts

- [ ] **Step 1: Update `.gitignore`**
Add after the last line:
```
# VN-Squad v3 runtime state (ephemeral — do not commit)
.vn-squad/skill-registry.json
.vn-squad/skill-registry-archive/
.vn-squad/session-context.json
.vn-squad/decisions.json
.vn-squad/prompt-patches.json
.vn-squad/specialization-profile/
.vn-squad/trajectories/
.vn-squad/skills/
# skill-manifest.json IS committed (stable index of skills)
```

- [ ] **Step 2: Update `package.json` scripts**
```json
"scripts": {
  "gemini": "node scripts/gemini-ask.js",
  "vn3:init": "node scripts/vn3/init-vn-squad.js",
  "vn3:manifest": "node scripts/vn3/skill-manifest.js",
  "vn3:registry": "node scripts/vn3/registry.js",
  "vn3:profile": "node scripts/vn3/profile.js",
  "vn3:routing": "node scripts/vn3/routing.js",
  "vn3:archive": "node scripts/vn3/archive.js",
  "vn3:status": "node scripts/vn3/routing.js --status"
}
```

- [ ] **Step 3: Update `AGENTS.md`** — add after the "Standard Prompt Template" section:

```markdown
## VN-Squad v3 Protocol Extensions

### AGENT_RESULT Block (v3 extended)

All agents MUST emit this block at the end of their response:

```
AGENT_RESULT:
  status: success | failure
  failure_code: EmptyDiff | CompileRed | TestFail | StaleBranch | PromptMisdelivery | ProviderFailure | none
  evidence: <single line describing what was observed>
  files_changed: <integer>
  quality_signals:
    review_verdict: APPROVE | REQUEST_CHANGES | not_run
    test_coverage: present | absent | unknown
```

### CONTEXT_PROPOSAL Block (optional — v3)

Agents MAY emit one CONTEXT_PROPOSAL block when they discover a convention or constraint
that would help sibling agents. This is ADVISORY — the Tech Lead decides whether to accept:

```
CONTEXT_PROPOSAL:
  key: conventions.<key_name>
  value: <value>
  rationale: <one line explaining why this helps other agents>
```

Rules:
- Maximum 1 CONTEXT_PROPOSAL per AGENT_RESULT
- Key must be namespaced: `conventions.*` or `constraints.*`
- Value must be a primitive (string, boolean, number) — no objects
- Do NOT propose keys that were previously rejected (check session context's rejected_keys)

### Recovery Annotation

When dispatching a recovery task (retry after failure), annotate the task prompt's first line:

```
[RETRY: <original-task-uuid>]
```

This links the recovery chain in `.vn-squad/session-context.json` automatically.
```

- [ ] **Step 4: Update `agents.json`** — add vn3 key:
```json
"vn3-scripts": {
  "description": "VN-Squad v3 self-improvement persistence layer scripts",
  "location": "scripts/vn3/",
  "scripts": {
    "init-vn-squad.js": "Bootstrap .vn-squad/ artifacts (idempotent)",
    "skill-manifest.js": "Scan .claude/commands/ → .vn-squad/skill-manifest.json",
    "registry.js": "Atomic append dispatch outcomes to skill-registry.json",
    "profile.js": "Recompute specialization-profile/ from registry",
    "routing.js": "Routing decision algorithm — weighted_success_rate",
    "session-context.js": "Seed/reset session-context.json, process CONTEXT_PROPOSALs",
    "archive.js": "POSIX-atomic archive migration for skill-registry.json",
    "patches.js": "prompt-patches lifecycle (add/expire/graduate)",
    "trajectories.js": "Classify and capture trajectory type"
  }
}
```

- [ ] **Step 5: Commit**
```bash
git add AGENTS.md .gitignore package.json agents.json && git commit -m "feat(vn3): extend AGENTS.md with CONTEXT_PROPOSAL protocol; update config files"
```

---

## Task 5: Profile Recompute + Routing Decision Algorithm

**Files:**
- Create: `scripts/vn3/profile.js`
- Create: `scripts/vn3/routing.js`

- [ ] **Step 1: Implement `scripts/vn3/profile.js`**
```javascript
// scripts/vn3/profile.js
// Recomputes specialization-profile/<agent>.json from skill-registry.json
// Implements: weighted_success_rate = (raw + recovery + confirmed×3) / (samples + confirmed×3)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { readEntries } from './registry.js';

const ROOT = process.cwd();
const PROFILES_DIR = join(ROOT, '.vn-squad', 'specialization-profile');
const TRAJECTORIES_DIR = join(ROOT, '.vn-squad', 'trajectories');

const AGENTS = ['gemini-worker', 'codex-worker', 'claude-subagent'];
const TASK_TYPES = ['code', 'test', 'research', 'docs', 'debug', 'refactor', 'review'];

function countTrajectories(agent, taskType, prefix) {
  if (!existsSync(TRAJECTORIES_DIR)) return 0;
  return readdirSync(TRAJECTORIES_DIR)
    .filter(f => f.startsWith(prefix))
    .filter(f => {
      try {
        const t = JSON.parse(readFileSync(join(TRAJECTORIES_DIR, f), 'utf8'));
        return t.agent === agent && t.task_type === taskType;
      } catch { return false; }
    }).length;
}

export function recomputeProfiles() {
  const entries = readEntries(); // active entries (last 6 months)

  for (const agent of AGENTS) {
    const profilePath = join(PROFILES_DIR, `${agent}.json`);
    const existing = existsSync(profilePath)
      ? JSON.parse(readFileSync(profilePath, 'utf8')) : {};

    const strengths = [];
    const weaknesses = [];
    const failureModes = {};

    for (const taskType of TASK_TYPES) {
      const agentEntries = entries.filter(e => e.agent === agent && e.task_type === taskType);
      if (agentEntries.length === 0) continue;

      const totalSamples = agentEntries.length;
      const rawSuccesses = agentEntries.filter(e => e.failure_code === 'none' && e.quality_signals?.review_verdict === 'APPROVE').length;
      const recoveryCount = countTrajectories(agent, taskType, 'recovery-');
      const patternConfirmedCount = countTrajectories(agent, taskType, 'pattern-confirmed-');

      const weightedRate = (rawSuccesses + recoveryCount + patternConfirmedCount * 3)
        / Math.max(1, totalSamples + patternConfirmedCount * 3);

      const dataLabel = totalSamples >= 10 ? 'stable' : totalSamples >= 3 ? 'preliminary' : 'insufficient';

      // Aggregate failure codes
      agentEntries
        .filter(e => e.failure_code && e.failure_code !== 'none')
        .forEach(e => { failureModes[e.failure_code] = (failureModes[e.failure_code] || 0) + 1; });

      const stat = { task_type: taskType, weighted_success_rate: +weightedRate.toFixed(3), sample_size: totalSamples, data_label: dataLabel };

      if (weightedRate >= 0.7 && totalSamples >= 3) strengths.push(stat);
      else if (weightedRate < 0.5 && totalSamples >= 3) weaknesses.push(stat);
    }

    const profile = {
      agent,
      last_recomputed_at: new Date().toISOString(),
      registry_entry_count_at_recompute: entries.filter(e => e.agent === agent).length,
      strengths,
      weaknesses,
      failure_modes: failureModes,
      constraints: existing.constraints || []
    };

    const tmp = join(tmpdir(), `profile-${agent}-${Date.now()}.json`);
    writeFileSync(tmp, JSON.stringify(profile, null, 2) + '\n');
    execSync(`mv "${tmp}" "${profilePath}"`);
    console.log(`✓ ${agent}: ${strengths.length} strengths, ${weaknesses.length} weaknesses`);
  }
}

if (process.argv[2] === '--recompute') recomputeProfiles();
```

- [ ] **Step 2: Implement `scripts/vn3/routing.js`**
```javascript
// scripts/vn3/routing.js
// Routing decision algorithm: suggest agent override based on specialization profiles.
// Reads specialization-profile/, compares weighted_success_rate vs AGENTS.md static table.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { appendDecision } from './decisions.js';

const ROOT = process.cwd();
const PROFILES_DIR = join(ROOT, '.vn-squad', 'specialization-profile');

// Static routing table from AGENTS.md (default assignments)
const STATIC_ROUTING = {
  code: 'claude-subagent',
  test: 'claude-subagent',
  research: 'gemini-worker',
  docs: 'gemini-worker',
  debug: 'claude-subagent',
  refactor: 'claude-subagent',
  review: 'codex-worker'
};

function loadProfile(agent) {
  const p = join(PROFILES_DIR, `${agent}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/**
 * Get routing suggestion for a task type.
 * Returns { suggested_agent, reason, confidence, data_label } or null if no override.
 */
export function getRoutingSuggestion(taskType) {
  const agents = ['gemini-worker', 'codex-worker', 'claude-subagent'];
  const candidates = [];

  for (const agent of agents) {
    const profile = loadProfile(agent);
    if (!profile) continue;

    const all = [...(profile.strengths || []), ...(profile.weaknesses || [])];
    const stat = all.find(s => s.task_type === taskType);
    if (!stat || stat.sample_size < 3) continue; // insufficient data

    candidates.push({ agent, ...stat });
  }

  if (candidates.length === 0) return null;

  // Sort by weighted_success_rate desc
  candidates.sort((a, b) => b.weighted_success_rate - a.weighted_success_rate);
  const best = candidates[0];
  const defaultAgent = STATIC_ROUTING[taskType];

  // Suggest override if:
  // 1. Best candidate is different from AGENTS.md default
  // 2. Best has rate >= 0.7
  // 3. Default (if measured) has rate < 0.5
  const defaultStat = candidates.find(c => c.agent === defaultAgent);
  const defaultRate = defaultStat?.weighted_success_rate ?? null;

  if (best.agent !== defaultAgent && best.weighted_success_rate >= 0.7
      && (defaultRate === null || defaultRate < 0.5)) {
    return {
      suggested_agent: best.agent,
      default_agent: defaultAgent,
      suggested_rate: best.weighted_success_rate,
      default_rate: defaultRate,
      sample_size: best.sample_size,
      data_label: best.data_label,
      reason: `${best.agent} outperforms ${defaultAgent} on ${taskType} (rate: ${best.weighted_success_rate.toFixed(2)} vs ${defaultRate?.toFixed(2) ?? 'no data'})`
    };
  }

  return null;
}

/**
 * Print routing calibration report for all task types.
 */
export function printRoutingStatus() {
  console.log('\n── VN-Squad v3 Routing Status ──\n');
  const taskTypes = ['code', 'test', 'research', 'docs', 'debug', 'refactor', 'review'];

  for (const tt of taskTypes) {
    const suggestion = getRoutingSuggestion(tt);
    const def = STATIC_ROUTING[tt];
    if (suggestion) {
      console.log(`[OVERRIDE] ${tt.padEnd(10)} → ${suggestion.suggested_agent} (${suggestion.data_label}, n=${suggestion.sample_size}, rate=${suggestion.suggested_rate.toFixed(2)})`);
      console.log(`           default: ${def} (rate=${suggestion.default_rate?.toFixed(2) ?? 'no data'})`);
    } else {
      console.log(`[default]  ${tt.padEnd(10)} → ${def}`);
    }
  }

  // Plateau check
  console.log('\n── Plateau Milestone ──');
  console.log('(Track in decisions.json: need >=3 distinct task_type routing_override_accepted with outcome==success)');
}

if (process.argv[2] === '--status') printRoutingStatus();
```

- [ ] **Step 3: Verify profile recompute (needs registry entry from Task 3)**
```bash
node scripts/vn3/profile.js --recompute
```
Expected: `✓ gemini-worker: 0 strengths, 0 weaknesses` (cold start — no data yet)

```bash
node scripts/vn3/routing.js --status
```
Expected: routing status table with all `[default]` entries (no overrides yet — correct at cold start)

- [ ] **Step 4: Commit**
```bash
git add scripts/vn3/profile.js scripts/vn3/routing.js && git commit -m "feat(vn3): profile recompute + routing decision algorithm (weighted_success_rate)"
```

---

## Task 6: Session Context + Archive Migration

**Files:**
- Create: `scripts/vn3/session-context.js`
- Create: `scripts/vn3/archive.js`

- [ ] **Step 1: Implement `scripts/vn3/session-context.js`**
```javascript
// scripts/vn3/session-context.js
// Manages session-context.json: seed/reset, CONTEXT_PROPOSAL processing, task tracking.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const ROOT = process.cwd();
const CTX_PATH = join(ROOT, '.vn-squad', 'session-context.json');
const TRAJECTORIES_DIR = join(ROOT, '.vn-squad', 'trajectories');

function getBranch() {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function atomicWrite(path, data) {
  const tmp = join(tmpdir(), `ctx-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  execSync(`mv "${tmp}" "${path}"`);
}

function findLastSuccessConventions(branch) {
  if (!existsSync(TRAJECTORIES_DIR)) return {};
  const successes = readdirSync(TRAJECTORIES_DIR)
    .filter(f => f.startsWith('success-'))
    .map(f => {
      try { return JSON.parse(readFileSync(join(TRAJECTORIES_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(t => t && t.branch === branch)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return successes[0]?.conventions || {};
}

export function resetSession() {
  const branch = getBranch();
  const seededConventions = findLastSuccessConventions(branch);
  const ctx = {
    schema_version: 1,
    session_id: randomUUID(),
    branch,
    created_at: new Date().toISOString(),
    seeded_from_trajectory: null,
    conventions: seededConventions,
    rejected_keys: [],
    pending_proposals: [],
    completed_tasks: []
  };
  atomicWrite(CTX_PATH, ctx);
  console.log(`✓ session-context.json reset (session: ${ctx.session_id})`);
  if (Object.keys(seededConventions).length > 0) {
    console.log(`  seeded conventions from last success: ${Object.keys(seededConventions).join(', ')}`);
  }
  return ctx;
}

export function readContext() {
  if (!existsSync(CTX_PATH)) return resetSession();
  return JSON.parse(readFileSync(CTX_PATH, 'utf8'));
}

/** Process a CONTEXT_PROPOSAL from an agent. Returns 'pending' — Tech Lead must accept/reject. */
export function addProposal(proposal) {
  const ctx = readContext();
  const alreadyRejected = ctx.rejected_keys.find(r => r.key === proposal.key);
  if (alreadyRejected) {
    console.warn(`⚠ Proposal for key "${proposal.key}" was previously rejected: ${alreadyRejected.reason}`);
  }
  if (ctx.pending_proposals.length >= 3) {
    console.warn(`⚠ Max 3 pending proposals — proposal deferred to next session`);
    return false;
  }
  ctx.pending_proposals.push({ id: randomUUID(), ...proposal, proposed_at: new Date().toISOString(), dispatch_cycles_pending: 0 });
  atomicWrite(CTX_PATH, ctx);
  console.log(`✓ proposal queued: ${proposal.key}`);
  return true;
}

/** Accept a pending proposal — merges into conventions. */
export function acceptProposal(proposalId) {
  const ctx = readContext();
  const idx = ctx.pending_proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) throw new Error(`Proposal ${proposalId} not found`);
  const [proposal] = ctx.pending_proposals.splice(idx, 1);
  const keyParts = proposal.key.split('.');
  const ns = keyParts[0]; const k = keyParts[1];
  if (!ctx.conventions[ns]) ctx.conventions[ns] = {};
  ctx.conventions[ns][k] = proposal.value;
  atomicWrite(CTX_PATH, ctx);
  console.log(`✓ accepted: ${proposal.key} = ${proposal.value}`);
  return proposal;
}

/** Reject a pending proposal — logs to rejected_keys. */
export function rejectProposal(proposalId, reason) {
  const ctx = readContext();
  const idx = ctx.pending_proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) throw new Error(`Proposal ${proposalId} not found`);
  const [proposal] = ctx.pending_proposals.splice(idx, 1);
  ctx.rejected_keys.push({ key: proposal.key, reason, agent: proposal.agent, timestamp: new Date().toISOString() });
  atomicWrite(CTX_PATH, ctx);
  console.log(`✓ rejected: ${proposal.key} (${reason})`);
}

/** Append a completed task to session context. */
export function appendTask(task) {
  const ctx = readContext();
  ctx.completed_tasks.push({ id: randomUUID(), ...task, timestamp: new Date().toISOString() });
  atomicWrite(CTX_PATH, ctx);
}

/** Advance dispatch cycle counter on pending proposals — expire after 2 cycles. */
export function advanceDispatchCycle() {
  const ctx = readContext();
  const expired = [];
  ctx.pending_proposals = ctx.pending_proposals.filter(p => {
    p.dispatch_cycles_pending = (p.dispatch_cycles_pending || 0) + 1;
    if (p.dispatch_cycles_pending >= 2) { expired.push(p); return false; }
    return true;
  });
  if (expired.length > 0) {
    console.log(`⚠ ${expired.length} proposal(s) expired after 2 dispatch cycles`);
  }
  atomicWrite(CTX_PATH, ctx);
  return expired;
}

if (process.argv[2] === '--reset') resetSession();
if (process.argv[2] === '--show') {
  const ctx = readContext();
  console.log(`Session: ${ctx.session_id}`);
  console.log(`Branch: ${ctx.branch}`);
  console.log(`Conventions: ${JSON.stringify(ctx.conventions)}`);
  console.log(`Pending proposals: ${ctx.pending_proposals.length}`);
  console.log(`Completed tasks: ${ctx.completed_tasks.length}`);
}
```

- [ ] **Step 2: Implement `scripts/vn3/archive.js`**
```javascript
// scripts/vn3/archive.js
// POSIX-atomic archive migration for skill-registry.json
// Entries older than 6 months are moved to skill-registry-archive/<year>-H<1|2>.json
// Uses mv --no-clobber (no TOCTOU race — eliminates guard check).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, '.vn-squad', 'skill-registry.json');
const ARCHIVE_DIR = join(ROOT, '.vn-squad', 'skill-registry-archive');

function getPeriod(dateStr) {
  const d = new Date(dateStr);
  const half = d.getMonth() < 6 ? 'H1' : 'H2';
  return `${d.getFullYear()}-${half}`;
}

export function runArchiveMigration() {
  if (!existsSync(REGISTRY_PATH)) { console.log('No registry to migrate'); return 0; }
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);

  const toArchive = registry.entries.filter(e => new Date(e.timestamp) < cutoff);
  const toKeep = registry.entries.filter(e => new Date(e.timestamp) >= cutoff);

  if (toArchive.length === 0) { console.log('✓ No entries to archive'); return 0; }

  // Group by period
  const byPeriod = {};
  toArchive.forEach(e => {
    const p = getPeriod(e.timestamp);
    if (!byPeriod[p]) byPeriod[p] = [];
    byPeriod[p].push(e);
  });

  let archived = 0;
  for (const [period, entries] of Object.entries(byPeriod)) {
    const archivePath = join(ARCHIVE_DIR, `${period}.json`);
    const archiveData = { schema_version: 1, period, entries };
    // Write to temp, mv --no-clobber (atomic, no TOCTOU)
    const tmp = join(tmpdir(), `archive-${period}-${Date.now()}.json`);
    writeFileSync(tmp, JSON.stringify(archiveData, null, 2) + '\n');
    try {
      execSync(`mv --no-clobber "${tmp}" "${archivePath}"`);
      archived += entries.length;
      console.log(`✓ archived ${entries.length} entries → ${period}.json`);
    } catch {
      // Another session won the race — archive already exists
      execSync(`rm -f "${tmp}"`);
      console.log(`  ${period}.json already exists (concurrent session) — skipped`);
    }
  }

  // Strip archived entries from active registry (atomic)
  const updated = { ...registry, entries: toKeep };
  const tmp2 = join(tmpdir(), `registry-stripped-${Date.now()}.json`);
  writeFileSync(tmp2, JSON.stringify(updated, null, 2) + '\n');
  execSync(`mv "${tmp2}" "${REGISTRY_PATH}"`);
  console.log(`✓ active registry: ${toKeep.length} entries (removed ${archived} archived)`);
  return archived;
}

if (process.argv[2] === '--run') runArchiveMigration();
```

- [ ] **Step 3: Verify session context**
```bash
node scripts/vn3/session-context.js --reset
node scripts/vn3/session-context.js --show
```
Expected: session_id UUID, branch name, empty conventions/proposals/tasks

- [ ] **Step 4: Verify archive (nothing to archive yet)**
```bash
node scripts/vn3/archive.js --run
```
Expected: `✓ No entries to archive`

- [ ] **Step 5: Commit**
```bash
git add scripts/vn3/session-context.js scripts/vn3/archive.js && git commit -m "feat(vn3): session-context lifecycle + POSIX-atomic archive migration"
```

---

## Task 7: Patches + Trajectories Lifecycle

**Files:**
- Create: `scripts/vn3/patches.js`
- Create: `scripts/vn3/trajectories.js`
- Create: `scripts/vn3/decisions.js`

- [ ] **Step 1: Implement `scripts/vn3/decisions.js`** (shared dependency)
```javascript
// scripts/vn3/decisions.js
// Atomic append to .vn-squad/decisions.json — audit log for all Tech Lead decisions.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const ROOT = process.cwd();
const DECISIONS_PATH = join(ROOT, '.vn-squad', 'decisions.json');

const VALID_TYPES = new Set([
  'routing_override_suggested', 'routing_override_accepted', 'routing_override_rejected',
  'proposal_accepted', 'proposal_rejected', 'proposal_expired',
  'patch_added', 'patch_conflict_resolved', 'patch_graduated', 'patch_expired',
  'registry_corrupted'
]);

export function appendDecision(entry) {
  if (!VALID_TYPES.has(entry.type)) throw new Error(`Invalid decision type: ${entry.type}`);
  const data = existsSync(DECISIONS_PATH)
    ? JSON.parse(readFileSync(DECISIONS_PATH, 'utf8'))
    : { schema_version: 1, entries: [] };

  const full = { id: randomUUID(), timestamp: new Date().toISOString(), dispatch_ref: null, outcome_ref: null, recovery_chain_final_ref: null, ...entry };
  data.entries.push(full);

  const tmp = join(tmpdir(), `decisions-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  execSync(`mv "${tmp}" "${DECISIONS_PATH}"`);
  return full;
}

export function readDecisions() {
  if (!existsSync(DECISIONS_PATH)) return [];
  return JSON.parse(readFileSync(DECISIONS_PATH, 'utf8')).entries;
}
```

- [ ] **Step 2: Implement `scripts/vn3/patches.js`**
```javascript
// scripts/vn3/patches.js
// prompt-patches lifecycle: add, expire (10 type-matched samples with 0 successes), graduate (>=5 successes).

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { appendDecision } from './decisions.js';

const ROOT = process.cwd();
const PATCHES_PATH = join(ROOT, '.vn-squad', 'prompt-patches.json');
const MAX_PER_AGENT_CATEGORY = 5;

function read() {
  if (!existsSync(PATCHES_PATH)) return { schema_version: 1, patches: [] };
  return JSON.parse(readFileSync(PATCHES_PATH, 'utf8'));
}

function write(data) {
  const tmp = join(tmpdir(), `patches-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  execSync(`mv "${tmp}" "${PATCHES_PATH}"`);
}

export function addPatch(patch) {
  const data = read();
  const activeInCategory = data.patches.filter(
    p => p.agent === patch.agent && p.category === patch.category && p.status === 'active'
  );

  if (activeInCategory.length >= MAX_PER_AGENT_CATEGORY) {
    // Find lowest-validated to surface conflict
    const lowest = activeInCategory.sort((a, b) => a.validated_successes - b.validated_successes)[0];
    const newPatch = { id: randomUUID(), ...patch, status: 'pending-conflict', samples_seen: 0, validated_successes: 0, added: new Date().toISOString(), conflict_with: lowest.id };
    data.patches.push(newPatch);
    write(data);
    console.warn(`⚠ CONFLICT: ${patch.agent}/${patch.category} at max (${MAX_PER_AGENT_CATEGORY}). Patch pending-conflict vs "${lowest.constraint.slice(0,40)}..." (${lowest.validated_successes} successes)`);
    return newPatch;
  }

  const newPatch = { id: randomUUID(), ...patch, status: 'active', samples_seen: 0, validated_successes: 0, added: new Date().toISOString() };
  data.patches.push(newPatch);
  write(data);
  appendDecision({ type: 'patch_added', agent: patch.agent, task_type: patch.target_task_types?.join(','), reason: patch.rationale });
  console.log(`✓ patch added: ${patch.agent}/${patch.category} — "${patch.constraint.slice(0, 60)}..."`);
  return newPatch;
}

export function recordDispatch(agent, taskType, wasSuccess) {
  const data = read();
  let changed = false;
  const graduated = [];

  data.patches = data.patches.map(p => {
    if (p.status !== 'active') return p;
    if (p.agent !== agent || !p.target_task_types?.includes(taskType)) return p;

    p.samples_seen = (p.samples_seen || 0) + 1;
    if (wasSuccess) p.validated_successes = (p.validated_successes || 0) + 1;
    changed = true;

    // Expiry: 10 type-matched samples with 0 successes
    if (p.samples_seen >= 10 && p.validated_successes === 0) {
      p.status = 'expired';
      appendDecision({ type: 'patch_expired', agent, task_type: taskType, reason: `0 successes after ${p.samples_seen} samples` });
      console.log(`✓ patch expired: ${p.id}`);
    }

    // Graduation: >= 5 validated_successes
    if (p.validated_successes >= 5 && p.status === 'active') {
      p.status = 'graduated';
      graduated.push(p);
      appendDecision({ type: 'patch_graduated', agent, task_type: taskType, reason: `${p.validated_successes} validated successes` });
      console.log(`★ patch graduated (promote to AGENTS.md): "${p.constraint.slice(0, 60)}..."`);
    }

    return p;
  });

  if (changed) write(data);
  return graduated;
}

export function getActivePatches(agent) {
  return read().patches.filter(p => p.agent === agent && p.status === 'active');
}

if (process.argv[2] === '--list') {
  const data = read();
  data.patches.forEach(p => console.log(`${p.status.padEnd(16)} ${p.agent} [${p.category}] samples=${p.samples_seen} successes=${p.validated_successes}`));
}
```

- [ ] **Step 3: Implement `scripts/vn3/trajectories.js`**
```javascript
// scripts/vn3/trajectories.js
// Classify and capture trajectory types:
//   success-<uuid>.json        — task-level success + APPROVE verdict
//   recovery-<uuid>.json       — 1st/2nd recovery chain (failure→success)
//   pattern-confirmed-<uuid>.json — 3rd+ occurrence of same (failure_code × task_type)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const ROOT = process.cwd();
const TRAJ_DIR = join(ROOT, '.vn-squad', 'trajectories');

function countPattern(failureCode, taskType) {
  if (!existsSync(TRAJ_DIR)) return 0;
  return readdirSync(TRAJ_DIR)
    .filter(f => f.startsWith('recovery-') || f.startsWith('pattern-confirmed-'))
    .filter(f => {
      try {
        const t = JSON.parse(readFileSync(join(TRAJ_DIR, f), 'utf8'));
        return t.failure_code === failureCode && t.task_type === taskType;
      } catch { return false; }
    }).length;
}

function saveTrajectory(prefix, data) {
  if (!existsSync(TRAJ_DIR)) execSync(`mkdir -p "${TRAJ_DIR}"`);
  const id = randomUUID();
  const path = join(TRAJ_DIR, `${prefix}${id}.json`);
  const tmp = join(tmpdir(), `traj-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify({ id, ...data, timestamp: new Date().toISOString() }, null, 2) + '\n');
  execSync(`mv "${tmp}" "${path}"`);
  console.log(`✓ trajectory saved: ${prefix}${id}`);
  return id;
}

/**
 * Classify and save a trajectory based on the dispatch outcome.
 * @param {object} outcome - Outcome fields from registry entry
 * @param {string} type - 'success' | 'recovery' | 'no_recovery' | 'skip'
 */
export function captureTrajectory(outcome, type) {
  if (type === 'success' && outcome.quality_signals?.review_verdict === 'APPROVE') {
    return saveTrajectory('success-', outcome);
  }

  if (type === 'recovery' && outcome.recovery_outcome === 'success') {
    const existingCount = countPattern(outcome.failure_code, outcome.task_type);
    const prefix = existingCount >= 2 ? 'pattern-confirmed-' : 'recovery-';
    return saveTrajectory(prefix, outcome);
  }

  // Skip: failure with no recovery, duplicate failure (no recovery), borderline quality
  return null;
}

if (process.argv[2] === '--list') {
  if (!existsSync(TRAJ_DIR)) { console.log('No trajectories yet'); process.exit(0); }
  const files = readdirSync(TRAJ_DIR);
  const counts = { 'success-': 0, 'recovery-': 0, 'pattern-confirmed-': 0 };
  files.forEach(f => { for (const p of Object.keys(counts)) if (f.startsWith(p)) counts[p]++; });
  console.log(`Trajectories: success=${counts['success-']} recovery=${counts['recovery-']} pattern-confirmed=${counts['pattern-confirmed-']}`);
}
```

- [ ] **Step 4: Verify**
```bash
node scripts/vn3/patches.js --list
```
Expected: (empty — no patches yet)

```bash
node scripts/vn3/trajectories.js --list
```
Expected: `No trajectories yet`

- [ ] **Step 5: Commit**
```bash
git add scripts/vn3/decisions.js scripts/vn3/patches.js scripts/vn3/trajectories.js && git commit -m "feat(vn3): decisions audit log, prompt-patch lifecycle, trajectory capture"
```

---

## Task 8: New Skills — scaffold.md + vn3-status.md

**Files:**
- Create: `.claude/commands/scaffold.md`
- Create: `.claude/commands/vn3-status.md`

- [ ] **Step 1: Create `.claude/commands/scaffold.md`**
```markdown
# /scaffold — Curriculum Task Decomposition

Generate a tiered difficulty ladder for a task that has failed or is too complex to
dispatch directly. Uses Gemini to decompose into increasingly complex sub-tasks.

## When to use
- A task has returned EmptyDiff or CompileRed after 2+ retries
- A task description is too broad to dispatch in a single agent call
- You want to break a complex feature into independently testable tiers

## Usage

```
/scaffold "<failed task description>"
```

## Workflow

1. Send to Gemini: "Decompose this task into 3-4 tiers of increasing complexity.
   Each tier must be independently testable and committable.
   Task: <description>"

2. Present tiers to Tech Lead for approval:
   ```
   Tier 1: <simplest subtask — interfaces/types only>
   Tier 2: <core implementation>
   Tier 3: <full feature with edge cases>
   Tier 4 (optional): <integration/hardening>
   ```

3. On Tech Lead approval: /dispatch each tier as a separate task.
   Gate each tier on success before dispatching the next.

4. After all tiers succeed: aggregate into session-context.json completed_tasks.

## Constraints
- Each tier must produce independently committed, testable work
- Tier N must not depend on tier N+1 being complete
- Do NOT call /argue, /gemini, or /codex:* skills inside scaffold
```

- [ ] **Step 2: Create `.claude/commands/vn3-status.md`**
```markdown
# /vn3-status — VN-Squad v3 Self-Improvement Status

Show current state of the v3 self-improvement layer:
- Routing calibration (specialization-profile suggestions)
- Session context (conventions, pending proposals, completed tasks)
- Patch status (active, expired, graduated)
- Trajectory counts
- Plateau milestone progress

## Usage

```
/vn3-status
```

## Workflow

Run in sequence:
```bash
node scripts/vn3/routing.js --status
node scripts/vn3/session-context.js --show
node scripts/vn3/patches.js --list
node scripts/vn3/trajectories.js --list
```

Then check plateau milestone:
```bash
node -e "
  import('./scripts/vn3/decisions.js').then(m => {
    const d = m.readDecisions();
    const overrides = d.filter(e => e.type === 'routing_override_accepted' && e.outcome_ref);
    const taskTypes = [...new Set(overrides.map(e => e.task_type))];
    console.log('Plateau: ' + taskTypes.length + '/3 distinct task_type overrides accepted');
    console.log('Task types:', taskTypes.join(', ') || 'none yet');
  });
"
```

## Output

Present a summary with:
- [ROUTING] Override suggestions (or "all defaults")
- [SESSION] Active conventions and pending proposals
- [PATCHES] Active patch count per agent
- [PLATEAU] Progress toward >=3 distinct task_type routing overrides
```

- [ ] **Step 3: Verify skill manifest picks up new skills**
```bash
node scripts/vn3/skill-manifest.js
```
Expected: `✓ skill-manifest.json — 10 skills indexed` (8 original + scaffold + vn3-status)

- [ ] **Step 4: Commit**
```bash
git add .claude/commands/scaffold.md .claude/commands/vn3-status.md && git commit -m "feat(vn3): scaffold (curriculum decomposition) and vn3-status skills"
```

---

## Integration Smoke Test (after all tasks complete)

```bash
# 1. Full init
node scripts/vn3/init-vn-squad.js

# 2. Generate skill manifest
node scripts/vn3/skill-manifest.js

# 3. Seed session context
node scripts/vn3/session-context.js --reset

# 4. Append a test registry entry
node scripts/vn3/registry.js --append '{"agent":"gemini-worker","task_type":"research","outcome":"success","failure_code":"none","quality_signals":{"review_verdict":"APPROVE","files_changed":2}}'

# 5. Recompute profiles
node scripts/vn3/profile.js --recompute

# 6. Check routing status
node scripts/vn3/routing.js --status

# 7. Check archive (nothing to archive yet)
node scripts/vn3/archive.js --run

# 8. List trajectories
node scripts/vn3/trajectories.js --list

# 9. Show session context
node scripts/vn3/session-context.js --show

# 10. Run vn3:init npm script
npm run vn3:init
```

All 10 steps must complete without errors.

Final commit:
```bash
git add -A && git commit -m "feat(vn3): complete integration — all scripts verified"
```
