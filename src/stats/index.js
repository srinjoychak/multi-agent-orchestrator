export class TaskStats {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    if (!db) throw new Error("Database connection required");
    this.db = db;
  }

  getSummary() {
    const rows = this.db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all();
    const summary = { total: 0, pending: 0, claimed: 0, in_progress: 0, done: 0, failed: 0 };
    for (const row of rows) {
      if (summary[row.status] !== undefined) {
        summary[row.status] = row.count;
      }
      summary.total += row.count;
    }
    return summary;
  }

  getByAgent() {
    const rows = this.db.prepare(`
      SELECT assigned_to, COUNT(*) as count 
      FROM tasks 
      WHERE assigned_to IS NOT NULL 
      GROUP BY assigned_to
    `).all();
    
    const byAgent = {};
    for (const row of rows) {
      byAgent[row.assigned_to] = row.count;
    }
    return byAgent;
  }

  getAvgDuration() {
    const row = this.db.prepare(`
      SELECT AVG((julianday(completed_at) - julianday(claimed_at)) * 86400000) as avg_ms
      FROM tasks 
      WHERE completed_at IS NOT NULL AND claimed_at IS NOT NULL
    `).get();
    
    return row && row.avg_ms !== null ? Math.round(row.avg_ms) : 0;
  }
}
