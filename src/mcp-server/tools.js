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
      },
      required: ['prompt'],
    },
  },
  {
    name: 'task_status',
    description: 'Get the status of all tasks or a specific task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID (e.g. "T1"). Omit for all tasks.',
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
      const tasks = await orchestrator.decomposeTasks(args.prompt);
      console.error(`[mcp] orchestrate: ${tasks.length} tasks decomposed`);
      await orchestrator.assignTasks(tasks);
      await orchestrator.executeTasks();
      const summary = await orchestrator.taskManager.getSummary();
      const allTasks = await orchestrator.taskManager.getTasks();
      return {
        summary,
        tasks: allTasks.map(t => ({
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
      const tasks = await orchestrator.taskManager.getTasks();
      const summary = await orchestrator.taskManager.getSummary();
      return { summary, tasks };
    }

    case 'task_diff': {
      const diff = await orchestrator.getTaskDiff(args.id);
      const task = await orchestrator.taskManager.getTask(args.id);
      const files = await orchestrator.worktreeManager.changedFiles(args.id, task.assigned_to ?? 'unknown');
      return { task_id: args.id, files_changed: files, diff };
    }

    case 'task_accept': {
      const result = await orchestrator.acceptTask(args.id);
      return { task_id: args.id, ...result };
    }

    case 'task_reject': {
      const task = await orchestrator.rejectTask(args.id, args.reason);
      return { task_id: args.id, status: task.status, message: `Re-queued with reason: ${args.reason}` };
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
      const containers = await docker.listWorkers();
      const summary = await orchestrator.taskManager.getSummary();
      return { containers, summary };
    }

    case 'task_reset': {
      orchestrator.taskManager.clear();
      await orchestrator.worktreeManager.reset();
      return { cleared: true, message: 'All tasks, jobs, and worktrees cleared.' };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
