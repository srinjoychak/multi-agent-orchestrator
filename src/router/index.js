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
   * @returns {Array<{task: Object, agentName: string}>}
   */
  assign(tasks) {
    const assignments = [];
    for (const task of tasks) {
      const agentName = this._selectAgent(task);
      if (agentName) {
        this._assignedCounts.set(agentName, (this._assignedCounts.get(agentName) ?? 0) + 1);
        assignments.push({ task, agentName });
      }
    }
    return assignments;
  }

  /**
   * Select the best agent for a single task.
   * @param {Object} task
   * @returns {string|null}
   */
  _selectAgent(task) {
    const agentNames = Array.from(this.adapters.keys());
    const prev = task.previous_agents ?? [];

    // 1. Capable + fresh agents
    if (task.type) {
      const capableFresh = agentNames.filter(name =>
        this._hasCapability(name, task.type) && !prev.includes(name)
      );
      if (capableFresh.length > 0) return this._pickByQuota(capableFresh);
    }

    // 2. Any fresh agent
    const fresh = agentNames.filter(name => !prev.includes(name));
    if (fresh.length > 0) return this._pickByQuota(fresh);

    // 3. Force-assign (all tried before — pick by quota)
    return this._pickByQuota(agentNames);
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
}
