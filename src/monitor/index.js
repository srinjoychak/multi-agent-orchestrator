/**
 * Workforce Monitor — monitors worker containers and auto-kills stuck ones.
 */

export class WorkforceMonitor {
  /**
   * @param {Object} docker - DockerRunner instance (or mock)
   * @param {Object} taskManager - TaskManager instance (or mock)
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=10000]
   * @param {number} [options.heartbeatTimeoutMs=60000]
   * @param {number} [options.timeoutMultiplier=2]
   */
  constructor(docker, taskManager, options = {}) {
    this.docker = docker;
    this.taskManager = taskManager;
    this.pollIntervalMs = options.pollIntervalMs ?? 10000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60000;
    this.timeoutMultiplier = options.timeoutMultiplier ?? 2;
    this._interval = null;
    this._lastCheck = null;
  }

  /** Start the periodic check. */
  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this.check().catch(console.error), this.pollIntervalMs);
  }

  /** Stop the periodic check. */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Perform one check of all worker containers.
   * @returns {Promise<{healthy: Object[], stuck: Object[], killed: string[]}>}
   */
  async check() {
    const containers = await this.docker.listWorkers();
    const healthy = [];
    const stuck = [];
    const killed = [];

    for (const container of containers) {
      // Parse task ID from container name: worker-<agent>-<taskId>
      // Known limitation: if agentName has a dash (like 'claude-code'),
      // this logic results in 'code-<taskId>'. We follow the specified logic anyway.
      const parts = container.name.split('-');
      const taskId = parts.slice(2).join('-');

      try {
        const task = await this.taskManager.getTask(taskId);
        
        // Calculate running time. Docker 'created' format can vary, 
        // but for unit tests we'll assume a parsable date string.
        const createdDate = new Date(container.created);
        const runningMs = Date.now() - createdDate.getTime();
        
        // Max running time: 5 minutes per retry, multiplied by threshold
        const taskTimeout = (task.max_retries ?? 1) * 300000;

        if (runningMs > this.timeoutMultiplier * taskTimeout) {
          stuck.push(container);
          const success = await this.docker.kill(container.name);
          if (success) killed.push(container.name);
          continue;
        }

        // Check heartbeat: if no recent log output
        const logs = await this.docker.logs(container.name, 1);
        if ((!logs.stdout && !logs.stderr) && runningMs > this.heartbeatTimeoutMs) {
          stuck.push(container);
          const success = await this.docker.kill(container.name);
          if (success) killed.push(container.name);
          continue;
        }

        healthy.push(container);
      } catch (err) {
        // Task not found or other error — don't kill unknown containers
        healthy.push(container);
      }
    }

    this._lastCheck = new Date().toISOString();
    return { healthy, stuck, killed };
  }

  /**
   * Get current status summary.
   * @returns {Promise<Object>}
   */
  async status() {
    return {
      containers: await this.docker.listWorkers(),
      summary: await this.taskManager.getSummary(),
      lastCheck: this._lastCheck,
    };
  }
}
