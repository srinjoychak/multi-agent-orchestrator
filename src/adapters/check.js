#!/usr/bin/env node

/**
 * Check which AI CLI agents are available on this system.
 * Usage: node src/adapters/check.js
 */

import { ClaudeCodeAdapter } from './claude-code.js';
import { GeminiAdapter } from './gemini.js';

async function checkAgents() {
  const adapters = [
    new ClaudeCodeAdapter(),
    new GeminiAdapter(),
  ];

  console.log('Checking available AI CLI agents...\n');

  for (const adapter of adapters) {
    const available = await adapter.isAvailable();
    const status = available ? 'AVAILABLE' : 'NOT FOUND';
    const icon = available ? '[+]' : '[-]';
    console.log(`  ${icon} ${adapter.name} (${adapter.command}) — ${status}`);
  }

  const availableCount = (await Promise.all(adapters.map((a) => a.isAvailable())))
    .filter(Boolean).length;

  console.log(`\n${availableCount}/${adapters.length} agents available.`);

  if (availableCount < 2) {
    console.log('\nWarning: At least 2 agents are needed for multi-agent orchestration.');
    console.log('Install missing agents:');
    console.log('  Claude Code: npm install -g @anthropic-ai/claude-code');
    console.log('  Gemini CLI:  npm install -g @anthropic-ai/gemini-cli (or see Google docs)');
  }
}

checkAgents().catch(console.error);
