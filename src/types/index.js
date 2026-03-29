/**
 * @typedef {'pending' | 'claimed' | 'in_progress' | 'done' | 'failed'} TaskStatus
 */

/**
 * @typedef {Object} TaskResultData
 * @property {string} summary - Human-readable summary of what was done
 * @property {string} provider - Provider that executed the task (e.g. "gemini", "claude", "codex")
 * @property {string} [model] - Exact model used (e.g. "gemini-2.5-pro")
 * @property {string[]} files_changed - List of files modified
 * @property {string} [commit_hash] - Git commit hash of the result
 * @property {{input: number, output: number}} [token_usage]
 * @property {number} duration_ms
 * @property {string} [logs_path] - Path to the container log file
 * @property {boolean} [conflicts] - True if merge-back had conflicts (child branch preserved)
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
 * @property {string|null} result_ref - Path to container log file (opaque reference, do not overload with JSON)
 * @property {TaskResultData|null} result_data - Structured result envelope
 * @property {string|null} worktree_branch - Git branch for this task
 * @property {number} retries
 * @property {number} max_retries
 * @property {string|null} subagent_name - Logical subagent role (e.g. "researcher", "implementer")
 * @property {string|null} provider - Execution backend (e.g. "gemini", "claude", "codex")
 * @property {string|null} model - Exact model used
 * @property {string|null} parent_task_id - ID of the parent task that spawned this one
 * @property {number} delegate_depth - Delegation nesting depth (0 = top-level)
 * @property {boolean} is_delegated - True if spawned mid-execution via delegate()
 * @property {string|null} routing_reason - Why this provider was chosen (or 'orchestrator_restart' for orphans)
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
    result_data: null,
    worktree_branch: null,
    retries: overrides.retry_count ?? 0,  // accept legacy 'retry_count' field from manual seeds
    max_retries: overrides.max_retries ?? 1,
    previous_agents: overrides.previous_agents || [],
    subagent_name: overrides.subagent_name ?? null,
    provider: overrides.provider ?? null,
    model: overrides.model ?? null,
    parent_task_id: overrides.parent_task_id ?? null,
    delegate_depth: overrides.delegate_depth ?? 0,
    is_delegated: overrides.is_delegated ?? false,
    routing_reason: overrides.routing_reason ?? null,
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
