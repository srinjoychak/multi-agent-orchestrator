// scripts/vn3/decisions.js (stub — full implementation in Task 7)
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
