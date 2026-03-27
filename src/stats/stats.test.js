import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { TaskStats } from './index.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      assigned_to TEXT,
      claimed_at TEXT,
      completed_at TEXT
    );
  `);
  return db;
}

test('TaskStats', async (t) => {
  await t.test('handles empty state', () => {
    const db = createTestDb();
    const stats = new TaskStats(db);
    
    assert.deepStrictEqual(stats.getSummary(), {
      total: 0, pending: 0, claimed: 0, in_progress: 0, done: 0, failed: 0
    });
    assert.deepStrictEqual(stats.getByAgent(), {});
    assert.strictEqual(stats.getAvgDuration(), 0);
  });

  await t.test('counts statuses correctly', () => {
    const db = createTestDb();
    db.prepare("INSERT INTO tasks (id, title, status) VALUES ('1', 'A', 'pending')").run();
    db.prepare("INSERT INTO tasks (id, title, status) VALUES ('2', 'B', 'done')").run();
    db.prepare("INSERT INTO tasks (id, title, status) VALUES ('3', 'C', 'done')").run();
    
    const stats = new TaskStats(db);
    const summary = stats.getSummary();
    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.pending, 1);
    assert.strictEqual(summary.done, 2);
    assert.strictEqual(summary.failed, 0);
  });

  await t.test('groups by agent correctly', () => {
    const db = createTestDb();
    db.prepare("INSERT INTO tasks (id, title, assigned_to) VALUES ('1', 'A', 'agent1')").run();
    db.prepare("INSERT INTO tasks (id, title, assigned_to) VALUES ('2', 'B', 'agent2')").run();
    db.prepare("INSERT INTO tasks (id, title, assigned_to) VALUES ('3', 'C', 'agent1')").run();
    db.prepare("INSERT INTO tasks (id, title, assigned_to) VALUES ('4', 'D', NULL)").run();
    
    const stats = new TaskStats(db);
    const byAgent = stats.getByAgent();
    assert.deepStrictEqual(byAgent, {
      agent1: 2,
      agent2: 1
    });
  });

  await t.test('calculates average duration using julianday correctly', () => {
    const db = createTestDb();
    // 1 day difference
    db.prepare("INSERT INTO tasks (id, title, claimed_at, completed_at) VALUES ('1', 'A', '2023-01-01 12:00:00', '2023-01-02 12:00:00')").run();
    // 0.5 day difference
    db.prepare("INSERT INTO tasks (id, title, claimed_at, completed_at) VALUES ('2', 'B', '2023-01-01 12:00:00', '2023-01-02 00:00:00')").run();
    
    const stats = new TaskStats(db);
    const avgDuration = stats.getAvgDuration();
    
    // Average difference is 0.75 days = 0.75 * 86400000 = 64800000 ms
    assert.strictEqual(avgDuration, 64800000);
  });

  await t.test('ignores tasks without complete timestamps for average duration', () => {
    const db = createTestDb();
    // 1 day difference
    db.prepare("INSERT INTO tasks (id, title, claimed_at, completed_at) VALUES ('1', 'A', '2023-01-01 12:00:00', '2023-01-02 12:00:00')").run();
    // Missing completed_at
    db.prepare("INSERT INTO tasks (id, title, claimed_at, completed_at) VALUES ('2', 'B', '2023-01-01 12:00:00', NULL)").run();
    
    const stats = new TaskStats(db);
    const avgDuration = stats.getAvgDuration();
    
    // Only '1' should be counted, so 1 day = 86400000 ms
    assert.strictEqual(avgDuration, 86400000);
  });
});
