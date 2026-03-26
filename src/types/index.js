/**
 * @typedef {'pending' | 'claimed' | 'in_progress' | 'done' | 'failed'} TaskStatus
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Unique task ID (e.g., "T1")
 * @property {string} title - Short task title
 * @property {string} description - Detailed task description / prompt
 * @property {string} [type] - Task type hint for routing: 'code'|'refactor'|'test'|'review'|'debug'|'research'|'docs'|'analysis'
 * @property {TaskStatus} status
 * @property {string|null} assigned_to - Agent name or null
 * @property {string|null} claimed_at - ISO timestamp
 * @property {string|null} completed_at - ISO timestamp
 * @property {string[]} depends_on - Task IDs this task is blocked by
 * @property {string|null} result_ref - Path to result file
 * @property {string|null} worktree_branch - Git branch for this task
 * @property {number} retries
 * @property {number} max_retries
 */

/**
 * @typedef {Object} TaskContext
 * @property {string} workDir - Git worktree path
 * @property {string} branch - Branch name
 * @property {string} projectRoot - Original project root
 * @property {Object} teamConfig - Shared team configuration
 */

/**
 * @typedef {Object} TaskResult
 * @property {'done' | 'failed'} status
 * @property {string} summary - Human-readable summary
 * @property {string[]} filesChanged - List of files modified
 * @property {string} output - Raw CLI output
 * @property {number} duration_ms
 */

/**
 * @typedef {Object} AgentMessage
 * @property {string} id - Unique message ID
 * @property {string} from - Sender agent name
 * @property {string} to - Recipient agent name or "broadcast"
 * @property {string} type - Message type
 * @property {Object} payload - Message data
 * @property {string} timestamp - ISO timestamp
 */

// Valid task status transitions
export const VALID_TRANSITIONS = {
  pending: ['claimed'],
  claimed: ['in_progress', 'pending'],    // pending = unclaim
  in_progress: ['done', 'failed', 'pending'], // pending = reject re-queue
  failed: ['pending'],                     // retry
  done: ['pending'],                       // pending = reject re-queue
};

// Agent names
export const AGENTS = {
  CLAUDE_CODE: 'claude-code',
  GEMINI: 'gemini',
  ORCHESTRATOR: 'orchestrator',
};

// Message types
export const MSG_TYPES = {
  TASK_ASSIGNED: 'task_assigned',
  TASK_UPDATE: 'task_update',
  FINDING: 'finding',
  QUESTION: 'question',
  RESPONSE: 'response',
  SHUTDOWN: 'shutdown',
  HEARTBEAT: 'heartbeat',
};

/**
 * Create a new task object with defaults
 * @param {Partial<Task>} overrides
 * @returns {Task}
 */
export function createTask(overrides = {}) {
  return {
    id: overrides.id || `T${Date.now()}`,
    title: overrides.title || '',
    description: overrides.description || '',
    type: overrides.type || null,
    status: 'pending',
    assigned_to: overrides.assigned_to || null,
    claimed_at: null,
    completed_at: null,
    depends_on: overrides.depends_on || [],
    result_ref: null,
    worktree_branch: null,
    retries: overrides.retry_count ?? 0,  // accept legacy 'retry_count' field from manual seeds
    max_retries: overrides.max_retries ?? 1,
    previous_agents: overrides.previous_agents || [],
    ...overrides,
  };
}

/**
 * Check if a status transition is valid
 * @param {TaskStatus} from
 * @param {TaskStatus} to
 * @returns {boolean}
 */
export function isValidTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
