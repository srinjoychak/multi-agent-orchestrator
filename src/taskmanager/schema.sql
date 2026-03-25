CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  type            TEXT CHECK(type IN ('code','refactor','test','review','debug','research','docs','analysis')) DEFAULT 'code',
  status          TEXT CHECK(status IN ('pending','claimed','in_progress','done','failed')) DEFAULT 'pending',
  assigned_to     TEXT,
  claimed_at      TEXT,
  completed_at    TEXT,
  depends_on      TEXT DEFAULT '[]',
  result_ref      TEXT,
  worktree_branch TEXT,
  container_id    TEXT,
  retries         INTEGER DEFAULT 0,
  max_retries     INTEGER DEFAULT 3,
  previous_agents TEXT DEFAULT '[]',
  token_usage     TEXT DEFAULT '{}',
  created_at      TEXT DEFAULT (datetime('now'))
);
