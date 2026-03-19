import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CommChannel } from './channel.js';
import { AGENTS } from '../types/index.js';

/**
 * File-based communication channel.
 *
 * Messages are stored as JSON files in inbox directories:
 *   .agent-team/inbox/{agent-name}/{timestamp}-{uuid}.json
 *
 * Broadcast writes a copy to every agent's inbox.
 * Polling-based receive (no file watcher in v1 — simpler and more portable).
 */
export class FileCommChannel extends CommChannel {
  /**
   * @param {string} baseDir - Path to .agent-team directory
   * @param {string[]} [agentNames] - List of known agent names
   */
  constructor(baseDir, agentNames = [AGENTS.CLAUDE_CODE, AGENTS.GEMINI, AGENTS.ORCHESTRATOR]) {
    super();
    this.baseDir = baseDir;
    this.inboxDir = join(baseDir, 'inbox');
    this.agentNames = agentNames;
    this._pollIntervals = new Map();
  }

  /**
   * Ensure inbox directories exist for all agents.
   */
  async initialize() {
    for (const name of this.agentNames) {
      const dir = join(this.inboxDir, name);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }
  }

  /**
   * Send a message to a specific agent's inbox.
   * @param {string} to
   * @param {import('../types/index.js').AgentMessage} message
   */
  async send(to, message) {
    const enriched = {
      ...message,
      id: message.id || randomUUID(),
      timestamp: message.timestamp || new Date().toISOString(),
      to,
    };

    const filename = `${enriched.timestamp.replace(/[:.]/g, '-')}-${enriched.id.slice(0, 8)}.json`;
    const filepath = join(this.inboxDir, to, filename);
    await writeFile(filepath, JSON.stringify(enriched, null, 2));
  }

  /**
   * Read and consume all pending messages for an agent.
   * Messages are deleted after reading (consume-once semantics).
   * @param {string} agentId
   * @returns {Promise<import('../types/index.js').AgentMessage[]>}
   */
  async receive(agentId) {
    const dir = join(this.inboxDir, agentId);
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort(); // timestamp order

    const messages = [];
    for (const file of jsonFiles) {
      const filepath = join(dir, file);
      try {
        const content = await readFile(filepath, 'utf-8');
        messages.push(JSON.parse(content));
        await unlink(filepath); // consume
      } catch {
        // Skip corrupted files
      }
    }

    return messages;
  }

  /**
   * Peek at messages without consuming them.
   * @param {string} agentId
   * @returns {Promise<import('../types/index.js').AgentMessage[]>}
   */
  async peek(agentId) {
    const dir = join(this.inboxDir, agentId);
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

    const messages = [];
    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(dir, file), 'utf-8');
        messages.push(JSON.parse(content));
      } catch {
        // Skip corrupted files
      }
    }

    return messages;
  }

  /**
   * Send a message to all known agents.
   * @param {import('../types/index.js').AgentMessage} message
   */
  async broadcast(message) {
    const enriched = {
      ...message,
      id: message.id || randomUUID(),
      timestamp: message.timestamp || new Date().toISOString(),
      to: 'broadcast',
    };

    await Promise.all(
      this.agentNames.map((name) => this.send(name, { ...enriched, to: name })),
    );
  }

  /**
   * Subscribe to messages with polling.
   * @param {string} agentId
   * @param {function} callback
   * @param {number} [intervalMs=1000] - Polling interval
   */
  subscribe(agentId, callback, intervalMs = 1000) {
    const interval = setInterval(async () => {
      const messages = await this.receive(agentId);
      for (const msg of messages) {
        callback(msg);
      }
    }, intervalMs);

    this._pollIntervals.set(agentId, interval);
  }

  /**
   * Clean up all polling intervals.
   */
  async destroy() {
    for (const interval of this._pollIntervals.values()) {
      clearInterval(interval);
    }
    this._pollIntervals.clear();
  }
}
