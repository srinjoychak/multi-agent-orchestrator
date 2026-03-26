/**
 * TokenTracker — parse and record token usage from agent stdout,
 * and provide aggregation queries over the tasks table.
 */

export class TokenTracker {
  /** @param {import('../taskmanager/index.js').TaskManager} taskManager */
  constructor(taskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Parse Claude's JSON stdout for token usage.
   * Looks for a JSON object containing usage fields in the stdout string.
   * @param {string} stdout
   * @returns {{input: number, output: number, cache_read: number, cost_usd: number}|null}
   */
  parseClaude(stdout) {
    try {
      // Claude outputs a JSON block with usage info; try each line
      const lines = stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const obj = JSON.parse(trimmed);
          const usage = obj.usage ?? obj;
          if (usage.input_tokens != null || usage.output_tokens != null) {
            return {
              input: usage.input_tokens ?? 0,
              output: usage.output_tokens ?? 0,
              cache_read: usage.cache_read_input_tokens ?? 0,
              cost_usd: usage.cost_usd ?? obj.cost_usd ?? 0,
            };
          }
        } catch {
          // not valid JSON on this line
        }
      }
      // Try parsing the whole stdout as JSON
      const obj = JSON.parse(stdout);
      const usage = obj.usage ?? obj;
      return {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cache_read: usage.cache_read_input_tokens ?? 0,
        cost_usd: usage.cost_usd ?? obj.cost_usd ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Estimate Gemini token usage from stdout + prompt (chars / 4).
   * @param {string} stdout
   * @param {string} prompt
   * @returns {{input_est: number, output_est: number, cost_usd: number}}
   */
  parseGemini(stdout, prompt) {
    const input_est = Math.ceil((prompt ?? '').length / 4);
    const output_est = Math.ceil((stdout ?? '').length / 4);
    return { input_est, output_est, cost_usd: 0 };
  }

  /**
   * Record token usage for a task.
   * @param {string} taskId
   * @param {Object} usage
   */
  async record(taskId, usage) {
    const db = this.taskManager.db;
    db.prepare('UPDATE tasks SET token_usage=? WHERE id=?').run(
      JSON.stringify(usage),
      taskId
    );
  }

  /**
   * Aggregate token usage by assigned_to agent.
   * @returns {Object[]} [{agent, task_count, total_input, total_output, total_cost_usd}]
   */
  async summaryByAgent() {
    const db = this.taskManager.db;
    const rows = db.prepare('SELECT assigned_to, token_usage FROM tasks WHERE assigned_to IS NOT NULL').all();

    const agents = {};
    for (const row of rows) {
      const agent = row.assigned_to;
      let usage = {};
      try { usage = JSON.parse(row.token_usage || '{}'); } catch { /* ignore */ }

      if (!agents[agent]) {
        agents[agent] = { agent, task_count: 0, total_input: 0, total_output: 0, total_cost_usd: 0 };
      }
      agents[agent].task_count += 1;
      agents[agent].total_input += usage.input ?? usage.input_est ?? 0;
      agents[agent].total_output += usage.output ?? usage.output_est ?? 0;
      agents[agent].total_cost_usd += usage.cost_usd ?? 0;
    }

    return Object.values(agents);
  }

  /**
   * Total cost and task count across all tasks.
   * @returns {{totalCost: number, taskCount: number}}
   */
  async totalCost() {
    const db = this.taskManager.db;
    const rows = db.prepare('SELECT token_usage FROM tasks').all();

    let totalCost = 0;
    let taskCount = rows.length;

    for (const row of rows) {
      try {
        const usage = JSON.parse(row.token_usage || '{}');
        totalCost += usage.cost_usd ?? 0;
      } catch { /* ignore */ }
    }

    return { totalCost, taskCount };
  }
}
