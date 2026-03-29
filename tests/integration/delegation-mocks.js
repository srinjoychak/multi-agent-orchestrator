/**
 * Mocks for Delegation Integration Tests
 */

export function makeMockDockerRunner() {
  return {
    defaultMemory: '2g',
    defaultTimeoutMs: 120000,
    stateDir: '/tmp/mock-state',
    logDir: '/tmp/mock-state/logs',
    run: async ({ taskId, agentName }) => {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: 'done',
          summary: `Mock output for ${taskId}`,
          responses: [`Mock response for ${agentName}`]
        }),
        stderr: '',
        duration_ms: 100,
        containerId: `mock-container-${taskId}`
      };
    },
    logs: async (containerId) => ({ stdout: 'mock logs', stderr: '' }),
    kill: async (containerId) => true,
    inspect: async (containerId) => ({ State: { Running: false, ExitCode: 0 } }),
    listWorkers: async () => [],
    isAvailable: async () => true,
    _resolveAuthPath: (p) => p
  };
}

export function makeMockWorktreeManager() {
  return {
    projectRoot: '/tmp/mock-project',
    worktreesDir: '/tmp/mock-project/.worktrees',
    worktreePath: (taskId, agentName) => `/tmp/mock-project/.worktrees/${agentName}-${taskId}`,
    branchName: (taskId, agentName) => `agent/${agentName}/${taskId}`,
    create: async (taskId, agentName) => ({
      path: `/tmp/mock-project/.worktrees/${agentName}-${taskId}`,
      branch: `agent/${agentName}/${taskId}`
    }),
    diff: async (taskId, agentName) => 'mock diff',
    changedFiles: async (taskId, agentName) => ['file1.js'],
    merge: async (taskId, agentName) => ({ success: true, conflicts: false, message: 'Merged' }),
    prune: async (taskId, agentName) => {},
    reset: async () => {}
  };
}

export function makeMockWorktreeManagerWithConflict() {
  return {
    projectRoot: '/tmp/mock-project',
    worktreesDir: '/tmp/mock-project/.worktrees',
    worktreePath: (taskId, agentName) => `/tmp/mock/${taskId}`,
    branchName: (taskId, agentName) => `agent/${agentName}/${taskId}`,
    create: async (taskId, agentName) => ({
      path: `/tmp/mock/${taskId}`,
      branch: `agent/${agentName}/${taskId}`,
    }),
    merge: async (taskId, agentName) => ({
      success: false,
      conflicts: true,
      message: 'CONFLICT (content): Merge conflict in src/auth/session.js\nAutomatic merge failed',
    }),
    prune: async () => { throw new Error('prune should not be called on conflict'); },
    diff: async () => 'mock diff',
    changedFiles: async () => ['src/auth/session.js'],
    reset: async () => {},
  };
}
