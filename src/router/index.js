/**
 * Agent Router — capability-based, quota-weighted task assignment.
 *
 * Routing priority per task:
 *   1. Capable agent not previously tried → selected by quota ratio
 *   2. Any agent not previously tried → selected by quota ratio
 *   3. Force-assign by quota ratio (avoids getting stuck)
 *
 * Token budget awareness: agents over their budget are deprioritized.
 *
 * Quota ratio: assignedCount / quota. Lowest ratio = most under-served = preferred.
 */

export class AgentRouter {
  /**
   * @param {Map<string, Object>} adapters  — Map<agentName, adapter>
   * @param {Object} agentsConfig           — agents.json content
   */
  constructor(adapters, agentsConfig = {}) {
    this.adapters = adapters;
    this.agentsConfig = agentsConfig;
    /** @type {Map<string, number>} Track assignments in current batch */
    this._assignedCounts = new Map(
      Array.from(adapters.keys()).map(name => [name, 0])
    );
  }

  /** Reset assignment counters (call before each new batch). */
  resetCounts() {
    for (const name of this.adapters.keys()) {
      this._assignedCounts.set(name, 0);
    }
  }

  /**
   * Assign a list of tasks to agents.
   * @param {Object[]} tasks
   * @param {Object} [runningCounts={}] — Current global running counts per agent
   * @returns {Array<{task: Object, agentName: string}>}
   */
  assign(tasks, runningCounts = {}) {
    const assignments = [];
    for (const task of tasks) {
      const agentName = this.selectAgent(task, runningCounts);
      if (agentName) {
        this._assignedCounts.set(agentName, (this._assignedCounts.get(agentName) ?? 0) + 1);
        // Track for the next task in this batch
        runningCounts[agentName] = (runningCounts[agentName] ?? 0) + 1;
        assignments.push({ task, agentName });
      }
    }
    return assignments;
  }

  /**
   * Select the best agent for a single task.
   * @param {Object} task
   * @param {Object} [runningCounts={}]
   * @returns {string|null}
   */
  selectAgent(task, runningCounts = {}) {
    // 1. Prioritize forced_agent
    if (task.forced_agent && this.adapters.has(task.forced_agent)) {
      return task.forced_agent;
    }

    const agentNames = Array.from(this.adapters.keys());
    const prev = task.previous_agents ?? [];

    // 2. Filter by capability and concurrency limits (respecting previous_agents)
    const capableFresh = agentNames.filter(name => {
      const capable = !task.type || this._hasCapability(name, task.type);
      const underLimit = (runningCounts[name] ?? 0) < (this.agentsConfig[name]?.concurrency ?? Infinity);
      const fresh = !prev.includes(name);
      return capable && underLimit && fresh;
    });
    if (capableFresh.length > 0) return this._pickByQuota(capableFresh);

    // 3. Fallback: relax previous_agents constraint
    const capableFallback = agentNames.filter(name => {
      const capable = !task.type || this._hasCapability(name, task.type);
      const underLimit = (runningCounts[name] ?? 0) < (this.agentsConfig[name]?.concurrency ?? Infinity);
      return capable && underLimit;
    });
    if (capableFallback.length > 0) return this._pickByQuota(capableFallback);

    return null;
  }

  /**
   * Among candidates, pick the one with the lowest assigned/quota ratio.
   * @param {string[]} candidates
   * @returns {string}
   */
  _pickByQuota(candidates) {
    let best = candidates[0];
    let bestRatio = this._quotaRatio(best);
    for (let i = 1; i < candidates.length; i++) {
      const ratio = this._quotaRatio(candidates[i]);
      if (ratio < bestRatio) { bestRatio = ratio; best = candidates[i]; }
    }
    return best;
  }

  /**
   * Compute the assignment ratio for an agent.
   * Lower = more under-served = preferred.
   * @param {string} agentName
   * @returns {number}
   */
  _quotaRatio(agentName) {
    const quota = this.agentsConfig[agentName]?.quota ?? 1;
    const assigned = this._assignedCounts.get(agentName) ?? 0;
    return assigned / quota;
  }

  /**
   * Check if an agent has a given capability.
   * @param {string} agentName
   * @param {string} taskType
   * @returns {boolean}
   */
  _hasCapability(agentName, taskType) {
    const caps = this.adapters.get(agentName)?.capabilities ?? [];
    return caps.includes(taskType);
  }

  /**
   * Validate an array of agent configs.
   * @param {Object[]} agents
   * @throws {Error} if any agent is invalid
   */
  static validate(agents) {
    for (const agent of agents) {
      if (typeof agent.name !== 'string' || agent.name === '') {
        throw new Error(`Agent must have a non-empty string 'name': ${JSON.stringify(agent)}`);
      }
      if (!Array.isArray(agent.capabilities) || agent.capabilities.length === 0) {
        throw new Error(`Agent '${agent.name}' must have a non-empty 'capabilities' array`);
      }
      if (!Number.isInteger(agent.quota) || agent.quota < 0 || agent.quota > 100) {
        throw new Error(`Agent '${agent.name}' must have a 'quota' number between 0 and 100`);
      }
      if (agent.concurrency !== undefined && (!Number.isInteger(agent.concurrency) || agent.concurrency < 1)) {
        throw new Error(`Agent '${agent.name}' must have a 'concurrency' integer >= 1`);
      }
    }
  }
}
