#!/usr/bin/env node
/**
 * Smoke test — MCP server JSON-RPC interface over stdio.
 *
 * Tests:
 *   1. Server starts and responds to initialize
 *   2. tools/list returns all expected tool names
 *   3. Single-instance guard: second server exits with code 1
 *
 * Usage:
 *   node tests/e2e/smoke.mjs
 *
 * Exit code: 0 = all pass, 1 = any failure
 */

import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SERVER_ENTRY = resolve(PROJECT_ROOT, 'src/mcp-server/index.js');

const EXPECTED_TOOLS = [
  'orchestrate',
  'task_status',
  'task_diff',
  'task_accept',
  'task_reject',
  'task_logs',
  'task_kill',
  'workforce_status',
];

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`PASS  ${label}`);
  passed++;
}

function fail(label, err) {
  console.log(`FAIL  ${label}`);
  console.log(`      ${err?.message ?? err}`);
  failed++;
}

/**
 * Spawn MCP server and return a simple RPC helper.
 * @returns {{ send, readLine, proc, kill }}
 */
function spawnServer() {
  const proc = spawn('node', [SERVER_ENTRY], {
    env: { ...process.env, PROJECT_ROOT },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  const lineResolvers = [];

  proc.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete tail
    for (const line of lines) {
      if (!line.trim()) continue;
      const resolve = lineResolvers.shift();
      if (resolve) resolve(line);
    }
  });

  function readLine(timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for server response')), timeoutMs);
      lineResolvers.push(line => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  let _id = 1;
  function send(method, params = {}) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params }) + '\n';
    proc.stdin.write(msg);
  }

  function kill() {
    proc.kill('SIGTERM');
  }

  return { send, readLine, proc, kill };
}

/**
 * Wait for a process to exit and return its exit code.
 */
function waitForExit(proc, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Process did not exit within timeout'));
    }, timeoutMs);
    proc.on('exit', code => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

// ─── Test 1: initialize handshake ─────────────────────────────────────────────

async function testInitialize() {
  const label = 'initialize handshake returns protocolVersion';
  const server = spawnServer();
  try {
    server.send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'smoke-test', version: '0.0.1' },
      capabilities: {},
    });
    const raw = await server.readLine();
    const msg = JSON.parse(raw);
    assert.ok(msg.result, 'expected result field');
    assert.ok(msg.result.protocolVersion, 'expected protocolVersion in result');
    pass(label);
  } catch (err) {
    fail(label, err);
  } finally {
    server.kill();
    await waitForExit(server.proc).catch(() => {});
  }
}

// ─── Test 2: tools/list ────────────────────────────────────────────────────────

async function testToolsList() {
  const label = 'tools/list returns all expected tool names';
  const server = spawnServer();
  try {
    // handshake first
    server.send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'smoke-test', version: '0.0.1' },
      capabilities: {},
    });
    await server.readLine(); // consume initialize response

    server.send('tools/list', {});
    const raw = await server.readLine();
    const msg = JSON.parse(raw);
    assert.ok(msg.result, 'expected result field');
    assert.ok(Array.isArray(msg.result.tools), 'expected tools array');

    const names = msg.result.tools.map(t => t.name);
    for (const expected of EXPECTED_TOOLS) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
    assert.equal(names.length, EXPECTED_TOOLS.length,
      `expected ${EXPECTED_TOOLS.length} tools, got ${names.length}: ${names.join(', ')}`);

    pass(label);
  } catch (err) {
    fail(label, err);
  } finally {
    server.kill();
    await waitForExit(server.proc).catch(() => {});
  }
}

// ─── Test 3: single-instance guard ────────────────────────────────────────────

async function testSingleInstanceGuard() {
  const label = 'single-instance guard: second server exits with code 1';
  const server1 = spawnServer();
  let server2 = null;
  try {
    // Bring server1 up
    server1.send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'smoke-test', version: '0.0.1' },
      capabilities: {},
    });
    await server1.readLine(); // wait for server1 to be live

    // Spawn second server — should exit immediately with code 1
    server2 = spawnServer();
    const code = await waitForExit(server2.proc, 10_000);
    assert.equal(code, 1, `expected exit code 1, got ${code}`);

    pass(label);
  } catch (err) {
    fail(label, err);
  } finally {
    if (server2) server2.kill();
    server1.kill();
    await waitForExit(server1.proc).catch(() => {});
  }
}

// ─── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== MCP Server Smoke Tests ===\n');

  await testInitialize();
  await testToolsList();
  await testSingleInstanceGuard();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
