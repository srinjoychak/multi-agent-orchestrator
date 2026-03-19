/**
 * Abstract communication channel interface.
 *
 * This interface decouples the orchestrator and adapters from the transport layer.
 * v1 uses FileCommChannel (file-based IPC).
 * v2 can swap in MqttCommChannel without changing any other code.
 */
export class CommChannel {
  /**
   * Send a message to a specific agent.
   * @param {string} to - Recipient agent name
   * @param {import('../types/index.js').AgentMessage} message
   * @returns {Promise<void>}
   */
  async send(to, message) {
    throw new Error('send() not implemented');
  }

  /**
   * Read all pending messages for an agent.
   * @param {string} agentId - Agent name
   * @returns {Promise<import('../types/index.js').AgentMessage[]>}
   */
  async receive(agentId) {
    throw new Error('receive() not implemented');
  }

  /**
   * Send a message to all agents.
   * @param {import('../types/index.js').AgentMessage} message
   * @returns {Promise<void>}
   */
  async broadcast(message) {
    throw new Error('broadcast() not implemented');
  }

  /**
   * Subscribe to incoming messages for an agent.
   * @param {string} agentId - Agent name
   * @param {function(import('../types/index.js').AgentMessage): void} callback
   * @returns {void}
   */
  subscribe(agentId, callback) {
    throw new Error('subscribe() not implemented');
  }

  /**
   * Clean up resources (file watchers, connections, etc.)
   * @returns {Promise<void>}
   */
  async destroy() {
    // Override in subclass
  }
}
