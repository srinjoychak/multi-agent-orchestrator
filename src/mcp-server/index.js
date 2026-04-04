#!/usr/bin/env node
/**
 * Orchestrator MCP Server — entry point.
 *
 * Supports two deployment modes:
 *
 *   1. Direct (per-session, stdio):
 *      node src/mcp-server/index.js
 *      Registration in ~/.claude/settings.json, ~/.gemini/settings.json, etc.
 *
 *   2. Docker MCP Toolkit (shared, all clients, all projects):
 *      docker mcp gateway run --profile vn-squad
 *      One registration in each client config pointing to the gateway.
 *      project_root passed per-call via orchestrate()/delegate() args.
 *
 * Multi-project: an orchestrator pool (Map<projectRoot, Orchestrator>) lazily
 * creates one Orchestrator per project root on first use. Each tool call that
 * accepts project_root resolves to the correct orchestrator automatically.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Orchestrator } from '../orchestrator/core.js';
import { DockerRunner } from '../docker/runner.js';
import { TOOLS, handleTool } from './tools.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Default project root — used when no project_root is supplied in a tool call.
// When spawned by an MCP client from inside a project dir, cwd == that project.
const DEFAULT_PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

// State dir lives on ext4 (survives WSL2 reboots; SQLite WAL locking works).
const STATE_DIR = join(homedir(), '.local', 'share', 'multi-agent-orchestrator-v3');
mkdirSync(STATE_DIR, { recursive: true });

const docker = new DockerRunner({ stateDir: STATE_DIR });

// ─── Orchestrator pool ────────────────────────────────────────────────────────
// One Orchestrator per project root, created lazily on first use.
// Allows a single containerized MCP server to serve any project on the machine.

/** @type {Map<string, {orchestrator: Orchestrator, ready: Promise<void>}>} */
const pool = new Map();

function getOrchestrator(projectRoot) {
  const root = projectRoot ?? DEFAULT_PROJECT_ROOT;
  if (!pool.has(root)) {
    const orch = new Orchestrator(root, { stateDir: STATE_DIR });
    const ready = orch.initialize({ quiet: true }).catch(err => {
      console.error(`[mcp-server] Orchestrator init failed for ${root}:`, err.message);
      pool.delete(root); // allow retry on next call
      throw err;
    });
    pool.set(root, { orchestrator: orch, ready });
    console.error(`[mcp-server] Orchestrator created for ${root}`);
  }
  return pool.get(root);
}

// Eagerly warm up the default project root so the first tool call is fast.
getOrchestrator(DEFAULT_PROJECT_ROOT);

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'multi-agent-orchestrator', version: '3.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const callArgs = args ?? {};

  // Resolve the right orchestrator for this call's project root.
  const { orchestrator, ready } = getOrchestrator(callArgs.project_root);
  await ready;

  try {
    const result = await handleTool(name, callArgs, orchestrator, docker);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    console.error(`[mcp-server] Tool ${name} failed:`, err.message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mcp-server] VN-Squad MCP server running (default project: ${DEFAULT_PROJECT_ROOT})`);
