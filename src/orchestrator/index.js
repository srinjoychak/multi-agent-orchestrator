#!/usr/bin/env node

/**
 * Multi-Agent Orchestrator — CLI entry point (Phase 3: chat-driven)
 *
 * Usage (step-by-step):
 *   node src/orchestrator/index.js decompose "Build a REST API with auth and tests"
 *   node src/orchestrator/index.js assign
 *   node src/orchestrator/index.js execute
 *   node src/orchestrator/index.js execute T1
 *   node src/orchestrator/index.js status
 *   node src/orchestrator/index.js accept T1
 *   node src/orchestrator/index.js reject T2 "Missing error handling"
 *   node src/orchestrator/index.js merge
 *   node src/orchestrator/index.js merge T1
 *   node src/orchestrator/index.js report
 *
 * Usage (autonomous, v1 compat):
 *   node src/orchestrator/index.js run "Build a REST API with auth and tests"
 *   node src/orchestrator/index.js --tasks tasks.json
 */

import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from './core.js';
import { stepDecompose } from './steps/decompose.js';
import { stepAssign } from './steps/assign.js';
import { stepExecute } from './steps/execute.js';
import { stepStatus } from './steps/status.js';
import { stepMerge } from './steps/merge.js';
import { stepReset } from './steps/reset.js';
import { stepReview } from './steps/review.js';
import { loadSession, recordReview, patchSession } from './session.js';
import { TaskManager } from '../taskmanager/index.js';

/**
 * Swappable handler map — allows tests to mock individual verbs via mock.method().
 * @type {{ stepDecompose, stepAssign, stepExecute, stepStatus, stepMerge, recordReview, patchSession }}
 */
export const _handlers = {
  stepDecompose,
  stepAssign,
  stepExecute,
  stepStatus,
  stepMerge,
  stepReset,
  stepReview,
  recordReview,
  patchSession,
};

// Re-export Orchestrator so existing imports of this module still work
export { Orchestrator } from './core.js';

const projectRoot = resolve(process.cwd());

async function main() {
  // Read args fresh each call so tests can set process.argv before calling main()
  const args = process.argv.slice(2);
  const verb = args[0];

  // ── Global flags ──────────────────────────────────────────────────────────

  if (args.includes('--version') || args.includes('-v')) {
    console.log('multi-agent-orchestrator v0.2.0');
    process.exit(0);
    return;
  }

  if (args.includes('--check-agents')) {
    await import('../adapters/check.js');
    return;
  }

  if (!verb || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
    return;
  }

  // ── Step verbs ────────────────────────────────────────────────────────────

  switch (verb) {

    case 'decompose': {
      // decompose "user prompt here"
      const prompt = args.slice(1).join(' ');
      await _handlers.stepDecompose(projectRoot, prompt);
      break;
    }

    case 'assign': {
      await _handlers.stepAssign(projectRoot);
      break;
    }

    case 'execute': {
      // execute [taskId]
      const taskId = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      await _handlers.stepExecute(projectRoot, taskId);
      break;
    }

    case 'status': {
      await _handlers.stepStatus(projectRoot);
      break;
    }

    case 'accept': {
      // accept <taskId>
      const taskId = args[1];
      if (!taskId) throw new Error('accept requires a task ID. Usage: accept T1');
      const orchestrator = new Orchestrator(projectRoot);
      const session = await _handlers.recordReview(orchestrator.agentTeamDir, taskId, 'accepted');
      console.log(`✓ ${taskId} accepted.`);
      // Advance phase to 'reviewing' if still on an earlier phase
      if (!['reviewing', 'merged', 'complete'].includes(session.phase)) {
        await _handlers.patchSession(orchestrator.agentTeamDir, { phase: 'reviewing' });
      }
      break;
    }

    case 'reject': {
      // reject <taskId> "reason"
      const taskId = args[1];
      const reason = args.slice(2).join(' ');
      if (!taskId) throw new Error('reject requires a task ID. Usage: reject T2 "reason"');
      const agentTeamDir = join(projectRoot, '.agent-team');
      await _handlers.recordReview(agentTeamDir, taskId, 'rejected', reason);
      // Re-queue the task: append rejection feedback and reset to pending
      const taskManager = new TaskManager(agentTeamDir);
      await taskManager.initialize();
      const task = await taskManager.getTask(taskId);
      if (task) {
        const updatedDescription =
          task.description + (reason ? `\n\n[Rejected: ${reason}]` : '\n\n[Rejected]');
        await taskManager.updateStatus(taskId, 'pending', {
          description: updatedDescription,
          assigned_to: null,
          claimed_at: null,
          completed_at: null,
        });
        console.log(`✗ ${taskId} rejected${reason ? `: ${reason}` : ''}.`);
        console.log(`  Task re-queued as pending with rejection feedback.`);
        console.log(`  Run: execute ${taskId}`);
      } else {
        console.log(`✗ ${taskId} rejected (task not found in task list).`);
      }
      break;
    }

    case 'reset': {
      // reset [--hard]
      const hard = args.includes('--hard');
      await _handlers.stepReset(projectRoot, hard);
      break;
    }

    case 'review': {
      // review [taskId]
      const taskId = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      await _handlers.stepReview(projectRoot, taskId);
      break;
    }

    case 'merge': {
      // merge [taskId]
      const taskId = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      await _handlers.stepMerge(projectRoot, taskId);
      break;
    }

    case 'report': {
      const orchestrator = new Orchestrator(projectRoot);
      await orchestrator.initialize({ quiet: true });
      const allTasks = await orchestrator.taskManager.getTasks();
      const mergeResult = await orchestrator.merger.mergeAll(allTasks);
      const report = await orchestrator.merger.generateReport(allTasks, mergeResult);
      console.log('\n' + report);
      await orchestrator.comms.destroy();
      break;
    }

    // ── v1 compat: autonomous run ───────────────────────────────────────────

    case 'run': {
      const prompt = args.slice(1).join(' ');
      if (!prompt) throw new Error('run requires a prompt. Usage: run "your task here"');
      const orchestrator = new Orchestrator(projectRoot);
      await orchestrator.initialize();
      await orchestrator.run(prompt);
      break;
    }

    // ── Legacy: bare prompt (v0.1 compat) ────────────────────────────────────

    default: {
      // If first arg looks like a prompt (not a flag), treat as autonomous run
      if (!verb.startsWith('-')) {
        const prompt = args.join(' ');
        const orchestrator = new Orchestrator(projectRoot);
        await orchestrator.initialize();
        await orchestrator.run(prompt);
      } else if (args.includes('--tasks')) {
        const fileIdx = args.indexOf('--tasks') + 1;
        const filePath = args[fileIdx];
        if (!filePath) throw new Error('--tasks requires a file path');
        const orchestrator = new Orchestrator(projectRoot);
        await orchestrator.initialize();
        const tasks = await orchestrator.loadTasksFromFile(filePath);
        await orchestrator.run(tasks);
      } else {
        printHelp();
        process.exit(1);
      }
    }
  }
}

function printHelp() {
  console.log(`
Multi-Agent Orchestrator v0.2.0

STEP-BY-STEP (chat-driven):
  decompose "prompt"       Decompose a request into tasks
  assign                   Assign tasks to agents by capability
  execute [taskId]         Execute all tasks, or one specific task
  status                   Show current session state (compact board)
  review [taskId]          Show detailed task results for review
  accept <taskId>          Mark a task result as accepted
  reject <taskId> "why"    Mark a task result as rejected
  merge [taskId]           Merge accepted task branches into main
  report                   Generate final summary report
  reset                    Clear session state to start fresh
  reset --hard             Also clear tasks.json (full reset)

AUTONOMOUS (v1 compat):
  run "prompt"             Decompose → assign → execute → merge in one shot
  --tasks <file>           Load tasks from JSON file and run autonomously

OTHER:
  --check-agents           Check which AI CLI agents are available
  --version                Print version
  --help                   Show this help
  `);
}

export { main };

// Only execute when run directly (node index.js ...), not when imported as a module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  });
}
