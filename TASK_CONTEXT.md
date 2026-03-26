# Task Context — T1

**Task:** Analyze TaskManager and Schema
**Type:** analysis

## Objective
Read and analyze `src/taskmanager/index.js` and `src/taskmanager/schema.sql` to understand the database connection handling and the `tasks` table schema. Confirm how the `taskManager` instance exposes its database connection and the exact structure of the `token_usage` and `assigned_to` columns to ensure correct SQL queries in subsequent tasks.

## Constraints
- Work only within: /mnt/d/ALL_AUTOMATION/copilot_adapter/.worktrees/claude-code-T1
- Do NOT modify files outside this worktree.
- Do NOT use save_memory or write to global config files.

## Analysis Findings

### Database Connection
- `TaskManager` class stores the `better-sqlite3` connection as `this.db` (public property).
- Exposed directly on the instance: `taskManager.db` — callers can run arbitrary prepared statements on it.
- Initialized in `async initialize()` with WAL mode and foreign keys enabled.

### `tasks` Table Schema (schema.sql)
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `title` | TEXT NOT NULL | |
| `description` | TEXT | |
| `type` | TEXT | CHECK IN ('code','refactor','test','review','debug','research','docs','analysis') |
| `status` | TEXT | CHECK IN ('pending','claimed','in_progress','done','failed') DEFAULT 'pending' |
| `assigned_to` | TEXT | **Nullable TEXT** — agent name string or NULL |
| `claimed_at` | TEXT | datetime string |
| `completed_at` | TEXT | datetime string |
| `depends_on` | TEXT | JSON array, DEFAULT '[]' |
| `result_ref` | TEXT | |
| `worktree_branch` | TEXT | |
| `container_id` | TEXT | |
| `retries` | INTEGER | DEFAULT 0 |
| `max_retries` | INTEGER | DEFAULT 3 |
| `previous_agents` | TEXT | JSON array, DEFAULT '[]' |
| `token_usage` | TEXT | **JSON object stored as TEXT**, DEFAULT '{}' |
| `created_at` | TEXT | DEFAULT datetime('now') |

### Key Column Details

**`assigned_to`** (TEXT, nullable):
- Plain text column holding the agent name string (e.g. `"gemini"`, `"claude-code"`).
- Set to agent name on `claimTask()`, reset to NULL on re-queue/retry/rejection.
- Query pattern: `WHERE assigned_to = ?` or `assigned_to IS NULL`.

**`token_usage`** (TEXT, stored as JSON):
- Stored as a JSON string in SQLite (e.g. `'{"input":100,"output":50}'`).
- Serialized via `JSON.stringify(val)` in `updateStatus()`.
- Deserialized via `JSON.parse()` in `_deserialise()` → returned as a JS object with fallback `{}`.
- To update via SQL: pass the JSON string directly: `UPDATE tasks SET token_usage = ? WHERE id = ?`.
- To query contents: use `json_extract(token_usage, '$.field')` in SQLite.

## Git Instructions
- This directory is a git worktree. Use shell commands (run_shell_command) for all git operations.
- Do NOT attempt to read the .git file directly — it is a worktree pointer.
- To commit: run_shell_command("git add -A && git commit -m \"task: T1\"") 
- Git identity is pre-configured — no need to set user.name or user.email.