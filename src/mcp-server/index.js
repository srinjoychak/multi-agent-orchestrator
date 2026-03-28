#!/usr/bin/env node
/**
 * Orchestrator MCP Server — entry point.
 *
 * Runs as a persistent daemon. Registers with Docker MCP Toolkit or
 * any MCP client (Claude Code, Gemini CLI) via stdio transport.
 *
 * Usage:
 *   node src/mcp-server/index.js
 *
 * Registration in Claude Code (~/.claude/settings.json):
 *   {
 *     "mcpServers": {
 *       "orchestrator": {
 *         "command": "node",
 *         "args": ["/mnt/d/ALL_AUTOMATION/copilot_adapter/src/mcp-server/index.js"],
 *         "env": { "PROJECT_ROOT": "/mnt/d/ALL_AUTOMATION/copilot_adapter" }
 *       }
 *     }
 *   }
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
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

// ─── Single-instance guard ────────────────────────────────────────────────────
// Use ~/.local/share — stable across WSL2 reboots unlike /tmp which is wiped.
const STATE_DIR = join(homedir(), '.local', 'share', 'multi-agent-orchestrator-v3');
const PID_FILE  = join(STATE_DIR, 'mcp-server.pid');

mkdirSync(STATE_DIR, { recursive: true });

if (existsSync(PID_FILE)) {
  const existingPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  try {
    process.kill(existingPid, 0);
    console.error(`[mcp-server] Already running (pid ${existingPid}). Exiting.`);
    process.exit(1);
  } catch {
    console.error(`[mcp-server] Stale PID file (pid ${existingPid}). Overwriting.`);
  }
}
writeFileSync(PID_FILE, String(process.pid));

function cleanup() {
  try { unlinkSync(PID_FILE); } catch { /* already gone */ }
}
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// ─── Initialize orchestrator ─────────────────────────────────────────────────

const orchestrator = new Orchestrator(PROJECT_ROOT);
const docker = new DockerRunner();

// Initialize in background — tools will wait if called before init completes
let initPromise = orchestrator.initialize({ quiet: true }).catch(err => {
  console.error('[mcp-server] Orchestrator init failed:', err.message);
  process.exit(1);
});

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

  // Ensure orchestrator is initialized before handling any tool call
  await initPromise;

  try {
    const result = await handleTool(name, args ?? {}, orchestrator, docker);
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
console.error('[mcp-server] Orchestrator MCP server running on stdio');
