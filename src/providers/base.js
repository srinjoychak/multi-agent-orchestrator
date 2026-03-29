/**
 * Base interface for provider adapters.
 * All vendor-specific CLI logic should be encapsulated in an implementation of this class.
 */
export class ProviderAdapter {
  /**
   * Build the CLI arguments to pass to the docker container.
   * @param {string} prompt The task prompt
   * @param {Object} [opts] Additional options (like is_delegated flag for boundaries)
   * @returns {string[]} Array of CLI arguments
   */
  buildCliArgs(prompt, opts = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Build the Docker bind-mount arguments for authentication,
   * handling isolated directories or read-only mounts as needed.
   * @param {string} taskId
   * @param {Object} [cfg] Optional configuration
   * @returns {Promise<{ args: string[], cleanup: () => Promise<void> }>}
   */
  async buildAuthMounts(taskId, cfg = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Parse the output from the CLI execution.
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} durationMs
   * @returns {{ status: string, summary: string, token_usage?: Object }}
   */
  parseOutput(stdout, stderr, durationMs) {
    throw new Error('Not implemented');
  }

  /**
   * Return the default model name for this provider.
   * @returns {string}
   */
  defaultModel() {
    throw new Error('Not implemented');
  }
}
