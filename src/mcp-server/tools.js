/**
 * MCP Tool Definitions — all 8 orchestrator tools.
 *
 * Each tool:
 *   - Has a JSON Schema input definition
 *   - Maps to an Orchestrator method
 *   - Returns structured JSON the Tech Lead can read natively
 */

export const TOOLS = [
  {
    name: 'orchestrate',
    description: 'Decompose a request into tasks, assign to agents, and execute in parallel Docker containers. Returns the task board when execution completes.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The software engineering request to orchestrate',
        },
        project_root: {
          type: 'string',
          description: 'Absolute path to the project to operate on (e.g. /home/user/my-app). Defaults to PROJECT_ROOT env var or cwd. Required when using the shared Docker MCP Toolkit deployment.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'task_status',
    description: 'Get the status of all tasks, a specific task by ID, or all tasks for a given subagent role.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID (e.g. "T1"). Omit for all tasks or use subagent_name filter.',
        },
        subagent_name: {
          type: 'string',
          description: 'Filter by subagent role (e.g. "gemini", "researcher"). Returns all tasks assigned to this role.',
        },
      },
    },
  },
  {
    name: 'task_diff',
    description: 'Get the git diff of a completed task worktree vs main branch.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_accept',
    description: 'Merge a completed task branch into main and clean up the worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID to accept and merge' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_reject',
    description: 'Re-queue a task with rejection feedback. The task will be re-assigned to a different agent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID to reject' },
        reason: { type: 'string', description: 'Rejection reason (appended to task description for the next agent)' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'task_discard',
    description: 'Permanently discard a completed task without re-queuing. Use when output is manually handled or the task is no longer needed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_logs',
    description: 'Get the last N lines of stdout/stderr from a running or recently completed worker container.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID' },
        tail: { type: 'number', description: 'Number of lines to return (default: 100)', default: 100 },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_kill',
    description: 'Force-stop a running worker container. Marks the task as failed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID of the worker to kill' },
      },
      required: ['id'],
    },
  },
  {
    name: 'workforce_status',
    description: 'Get the live status of all running worker containers and the task board summary.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'task_reset',
    description: 'Clear all tasks and jobs from the database without restarting the server.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'delegate',
    description: 'Delegate a task to a specific subagent and block until it completes. Returns the result envelope. Use this to hand off well-scoped work to a specialist (gemini for research/analysis, claude-code for precision code, codex for broad refactoring).',
    inputSchema: {
      type: 'object',
      properties: {
        subagent_name: {
          type: 'string',
          description: 'Agent to delegate to: "gemini", "claude-code", or "codex"',
        },
        prompt: {
          type: 'string',
          description: 'Full task description / instructions for the subagent',
        },
        type: {
          type: 'string',
          enum: ['code', 'refactor', 'test', 'review', 'debug', 'research', 'docs', 'analysis'],
          description: 'Task type hint. Determines whether merge-back runs (research/analysis/docs skip merge).',
          default: 'code',
        },
        parent_task_id: {
          type: 'string',
          description: 'ID of the parent task that is delegating (optional). Used for delegation depth tracking.',
        },
        project_root: {
          type: 'string',
          description: 'Absolute path to the project to operate on. Defaults to PROJECT_ROOT env var or cwd.',
        },
      },
      required: ['subagent_name', 'prompt'],
    },
  },
  {
    name: 'list_subagents',
    description: 'List all configured subagents with their capabilities, quota, and current availability.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Handle a tool call from the Tech Lead.
 * @param {string} toolName
 * @param {Object} args
 * @param {import('../orchestrator/core.js').Orchestrator} orchestrator
 * @param {import('../docker/runner.js').DockerRunner} docker
 * @returns {Promise<Object>}
 */
export async function handleTool(toolName, args, orchestrator, docker) {
  switch (toolName) {

    case 'orchestrate': {
      const result = await orchestrator.orchestrate(args.prompt);
      return {
        summary: result.tasks.reduce((s, t) => {
          s[t.status] = (s[t.status] || 0) + 1;
          s.total = (s.total || 0) + 1;
          return s;
        }, {}),
        tasks: result.tasks.map(t => ({
          id: t.id,
          title: t.title,
          type: t.type,
          status: t.status,
          assigned_to: t.assigned_to,
          token_usage: t.token_usage,
        })),
      };
    }

    case 'task_status': {
      if (args.id) {
        const task = await orchestrator.taskManager.getTask(args.id);
        return { task };
      }
      if (args.subagent_name) {
        const tasks = await orchestrator.taskManager.getTasksBySubagent(args.subagent_name);
        return { subagent_name: args.subagent_name, count: tasks.length, tasks };
      }
      const tasks = await orchestrator.taskManager.getTasks();
      const summary = await orchestrator.taskManager.getSummary();
      return { summary, tasks };
    }

    case 'task_diff': {
      const diff = await orchestrator.getTaskDiff(args.id);
      const task = await orchestrator.taskManager.getTask(args.id);
      const files = await orchestrator.worktreeManager.changedFiles(args.id, task.assigned_to ?? 'unknown');
      const resultMeta = task.result_data ?? {};
      const provider = task.provider ?? resultMeta.provider ?? task.assigned_to ?? null;
      const model = task.model ?? resultMeta.model ?? null;

      const header = [
        task.subagent_name  ? `subagent:  ${task.subagent_name}`  : null,
        provider            ? `provider:  ${provider}`            : null,
        model               ? `model:     ${model}`               : null,
        task.delegate_depth != null ? `depth:     ${task.delegate_depth}` : null,
        task.parent_task_id ? `parent:    ${task.parent_task_id}` : null,
        task.routing_reason ? `routed:    ${task.routing_reason}` : null,
      ].filter(Boolean).join('\n');

      const annotatedDiff = header ? `${header}\n\n${diff}` : diff;
      return { task_id: args.id, files_changed: files, diff: annotatedDiff };
    }

    case 'task_accept': {
      const result = await orchestrator.acceptTask(args.id);
      return { task_id: args.id, ...result };
    }

    case 'task_reject': {
      const task = await orchestrator.rejectTask(args.id, args.reason);
      return { task_id: args.id, status: task.status, message: `Re-queued with reason: ${args.reason}` };
    }

    case 'task_discard': {
      const result = await orchestrator.discardTask(args.id);
      return { task_id: args.id, ...result };
    }

    case 'task_logs': {
      const logs = await orchestrator.getTaskLogs(args.id, args.tail ?? 100);
      return { task_id: args.id, ...logs };
    }

    case 'task_kill': {
      const result = await orchestrator.killTask(args.id);
      return { task_id: args.id, ...result };
    }

    case 'workforce_status': {
      const status = await orchestrator.getWorkforceStatus();
      const summary = await orchestrator.taskManager.getSummary();
      // Keep legacy keys for backward compatibility while exposing richer status.
      return {
        containers: status.containers,
        summary,
        workforce: status,
        task_summary: summary,
      };
    }

    case 'task_reset': {
      orchestrator.taskManager.clear();
      await orchestrator.worktreeManager.reset();
      return { cleared: true, message: 'All tasks, jobs, and worktrees cleared.' };
    }

    case 'delegate': {
      const result = await orchestrator.delegate(
        args.subagent_name,
        args.prompt,
        args.type ?? 'code',
        args.parent_task_id ?? null,
      );
      return { result };
    }

    case 'list_subagents': {
      const agents = Array.from(orchestrator.agents.entries()).map(([name, cfg]) => ({
        name,
        capabilities: cfg.capabilities,
        quota: cfg.quota,
        concurrency: cfg.concurrency ?? 1,
        image: cfg.image,
      }));
      return { subagents: agents };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
