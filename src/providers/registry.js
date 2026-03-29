import { GeminiAdapter } from './gemini.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

/**
 * Registry for provider adapters.
 * Maps provider names and aliases to their respective adapter instances.
 */
class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this.register('gemini', new GeminiAdapter());
    this.register('claude', new ClaudeAdapter());
    this.register('claude-code', this.get('claude')); // Alias
    this.register('codex', new CodexAdapter());
  }

  /**
   * Register a new provider adapter.
   * @param {string} name 
   * @param {import('./base.js').ProviderAdapter} adapter 
   */
  register(name, adapter) {
    this.adapters.set(name.toLowerCase(), adapter);
  }

  /**
   * Get an adapter by name.
   * @param {string} name 
   * @returns {import('./base.js').ProviderAdapter}
   * @throws {Error} if provider is unknown
   */
  get(name) {
    const adapter = this.adapters.get(name.toLowerCase());
    if (!adapter) {
      throw new Error(`Unknown provider: ${name}`);
    }
    return adapter;
  }

  /**
   * Get all registered provider names.
   * @returns {string[]}
   */
  listProviders() {
    return Array.from(this.adapters.keys());
  }
}

export const registry = new ProviderRegistry();
