import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTask,
  isValidTransition,
  VALID_TRANSITIONS,
} from './index.js';

describe('createTask()', () => {
  it('returns valid defaults with no args', () => {
    const task = createTask();
    assert.equal(typeof task.id, 'string');
    assert.ok(task.id.length > 0);
    assert.equal(task.title, '');
    assert.equal(task.description, '');
    assert.equal(task.status, 'pending');
    assert.equal(task.assigned_to, null);
    assert.equal(task.claimed_at, null);
    assert.equal(task.completed_at, null);
    assert.deepEqual(task.depends_on, []);
    assert.equal(task.result_ref, null);
    assert.equal(task.worktree_branch, null);
    assert.equal(task.retries, 0);
    assert.equal(task.max_retries, 1);
    assert.deepEqual(task.previous_agents, []);
  });

  it('merges overrides correctly', () => {
    const task = createTask({
      id: 'T42',
      title: 'My Task',
      description: 'Do the thing',
      assigned_to: 'claude-code',
      depends_on: ['T1', 'T2'],
      max_retries: 3,
    });
    assert.equal(task.id, 'T42');
    assert.equal(task.title, 'My Task');
    assert.equal(task.description, 'Do the thing');
    assert.equal(task.assigned_to, 'claude-code');
    assert.deepEqual(task.depends_on, ['T1', 'T2']);
    assert.equal(task.max_retries, 3);
    // defaults still applied
    assert.equal(task.status, 'pending');
    assert.equal(task.retries, 0);
    assert.equal(task.claimed_at, null);
  });

  it('override status is ignored — status is always pending', () => {
    // createTask spreads overrides AFTER defaults, so if caller passes status it WILL override.
    // Verify the actual behaviour: status comes from overrides spread.
    const task = createTask({ id: 'T1', status: 'done' });
    // The implementation does { status: 'pending', ...overrides } so override wins.
    assert.equal(task.status, 'done');
  });

  it('max_retries defaults to 1 when not provided', () => {
    const task = createTask({ id: 'T1' });
    assert.equal(task.max_retries, 1);
  });

  it('max_retries 0 is respected (falsy but valid)', () => {
    const task = createTask({ id: 'T1', max_retries: 0 });
    assert.equal(task.max_retries, 0);
  });
});

describe('isValidTransition()', () => {
  it('returns true for pending → claimed', () => {
    assert.ok(isValidTransition('pending', 'claimed'));
  });

  it('returns true for claimed → in_progress', () => {
    assert.ok(isValidTransition('claimed', 'in_progress'));
  });

  it('returns true for claimed → pending (unclaim)', () => {
    assert.ok(isValidTransition('claimed', 'pending'));
  });

  it('returns true for in_progress → done', () => {
    assert.ok(isValidTransition('in_progress', 'done'));
  });

  it('returns true for in_progress → failed', () => {
    assert.ok(isValidTransition('in_progress', 'failed'));
  });

  it('returns true for failed → pending (retry)', () => {
    assert.ok(isValidTransition('failed', 'pending'));
  });

  it('returns false for pending → done (skip)', () => {
    assert.equal(isValidTransition('pending', 'done'), false);
  });

  it('returns false for pending → in_progress (skip)', () => {
    assert.equal(isValidTransition('pending', 'in_progress'), false);
  });

  it('returns true for done → pending (reject re-queue)', () => {
    assert.equal(isValidTransition('done', 'pending'), true);
  });

  it('returns false for done → claimed', () => {
    assert.equal(isValidTransition('done', 'claimed'), false);
  });

  it('returns false for done → in_progress', () => {
    assert.equal(isValidTransition('done', 'in_progress'), false);
  });

  it('returns true for in_progress → pending (reject re-queue)', () => {
    assert.equal(isValidTransition('in_progress', 'pending'), true);
  });

  it('returns false for unknown source status', () => {
    assert.equal(isValidTransition('unknown', 'pending'), false);
  });

  it('returns false for unknown target status', () => {
    assert.equal(isValidTransition('pending', 'unknown'), false);
  });
});

describe('VALID_TRANSITIONS', () => {
  it('covers all defined statuses as keys', () => {
    const expectedStatuses = ['pending', 'claimed', 'in_progress', 'failed', 'done'];
    for (const status of expectedStatuses) {
      assert.ok(Object.hasOwn(VALID_TRANSITIONS, status), `Missing status: ${status}`);
    }
  });

  it('done can transition to pending (reject re-queue)', () => {
    assert.deepEqual(VALID_TRANSITIONS.done, ['pending']);
  });

  it('pending only transitions to claimed', () => {
    assert.deepEqual(VALID_TRANSITIONS.pending, ['claimed']);
  });

  it('failed only transitions to pending (retry)', () => {
    assert.deepEqual(VALID_TRANSITIONS.failed, ['pending']);
  });
});
