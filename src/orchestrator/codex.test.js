import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Orchestrator } from './core.js';

async function makeDirs() {
  const root = join(tmpdir(), `orch-codex-project-${randomUUID()}`);
  const state = join(tmpdir(), `orch-codex-state-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  await mkdir(state, { recursive: true });
  return { root, state };
}

describe('Codex agent defaults', () => {
  it('registers codex with non-interactive CLI args', async () => {
    const { root, state } = await makeDirs();
    try {
      const orchestrator = new Orchestrator(root, { stateDir: state });
      await orchestrator.initialize({ quiet: true });

      const codex = orchestrator.agents.get('codex');
      assert.ok(codex, 'codex agent should exist');
      assert.equal(codex.image, 'worker-codex:latest');
      assert.ok(codex.capabilities.includes('code'));
      assert.ok(codex.capabilities.includes('review'));
      assert.ok(codex.capabilities.includes('docs'));

      const args = codex.cliArgs('implement task');
      assert.equal(args[0], 'exec');
      assert.ok(args.includes('--json'));
      assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
      assert.ok(args.includes('--skip-git-repo-check'));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  });

  it('supports timeout_seconds override for codex in agents.json', async () => {
    const { root, state } = await makeDirs();
    try {
      await writeFile(
        join(root, 'agents.json'),
        JSON.stringify({
          codex: {
            timeout_seconds: 42,
            concurrency: 1,
          },
        }, null, 2),
      );

      const orchestrator = new Orchestrator(root, { stateDir: state });
      await orchestrator.initialize({ quiet: true });
      const codex = orchestrator.agents.get('codex');

      assert.equal(codex.timeoutMs, 42_000);
      assert.equal(codex.concurrency, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  });
});
