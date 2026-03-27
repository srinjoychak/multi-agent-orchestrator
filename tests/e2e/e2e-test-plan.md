# E2E Test Plan — Multi-Agent Orchestrator MCP Server

## Overview

The orchestrator MCP server communicates over **JSON-RPC 2.0 via stdio**. An MCP client
(Claude Code, Gemini CLI, or a test harness) spawns the server as a child process and sends
newline-delimited JSON objects on stdin; the server replies on stdout.

**State directory:** `/tmp/multi-agent-orchestrator-v3`
**PID file:** `/tmp/multi-agent-orchestrator-v3/server.pid` (single-instance guard)
**Server entry:** `node src/mcp-server/index.js`
**Environment:** `PROJECT_ROOT=<repo root>`

---

## Interface Protocol

### MCP Handshake

Every client session begins with two mandatory exchanges:

1. **`initialize`** — negotiate protocol version and capabilities.
2. **`tools/list`** — enumerate available tools.

After that the client may issue any number of **`tools/call`** requests.

### Message Format

```jsonc
// Request (client → server, one JSON object per line)
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2024-11-05",
              "clientInfo": { "name": "test", "version": "0.0.1" },
              "capabilities": {} } }

// Response (server → client, one JSON object per line)
{ "jsonrpc": "2.0", "id": 1, "result": { ... } }

// Error response
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32600, "message": "..." } }
```

---

## Test Sections

### 1. Server Startup & Handshake

#### TC-STARTUP-01 — initialize handshake (happy path)

```
Given  the server process is not running
When   a client spawns `node src/mcp-server/index.js`
  And  sends a valid `initialize` request with protocolVersion "2024-11-05"
Then   the server responds with { "result": { "protocolVersion": "2024-11-05", "capabilities": { "tools": {} }, ... } }
  And  exit code is not emitted (server stays alive)
```

#### TC-STARTUP-02 — tools/list returns all expected tools

```
Given  a successfully initialized MCP session
When   client sends { "method": "tools/list" }
Then   result.tools contains exactly these names (order-insensitive):
         orchestrate, task_status, task_diff, task_accept,
         task_reject, task_logs, task_kill, workforce_status
  And  each tool entry has { name, description, inputSchema }
```

#### TC-STARTUP-03 — server emits startup log to stderr

```
Given  the server starts
Then   stderr contains "[mcp-server] Orchestrator MCP server running on stdio"
```

---

### 2. Single-Instance Guard

The server writes its PID to `<stateDir>/server.pid` on startup and removes it on clean exit.
A second instance checks the PID file and exits immediately if the first is still running.

#### TC-GUARD-01 — second instance exits with code 1

```
Given  instance A is running (PID file present)
When   instance B is spawned
Then   instance B exits with code 1
  And  instance B stderr contains "already running" or "PID"
  And  instance A continues to serve requests normally
```

#### TC-GUARD-02 — stale PID file is ignored

```
Given  a PID file exists whose PID refers to a dead process
When   a new server instance is spawned
Then   the server starts successfully (overwrites stale PID file)
  And  the server responds to initialize normally
```

#### TC-GUARD-03 — PID file is removed on clean exit

```
Given  the server is running
When   the server process receives SIGTERM
Then   the server exits with code 0
  And  the PID file no longer exists
```

---

### 3. Inode-Safety (reset while CWD is inside stateDir)

The orchestrator can reset/recreate the state directory. If a process has its CWD inside
that directory, an `rm -rf` + `mkdir` would break the process unless the implementation
uses `inode`-safe replacement (rename or unlink individual files).

#### TC-INODE-01 — reset while CWD is stateDir does not crash server

```
Given  the server is running with CWD = stateDir
When   an internal reset is triggered (e.g. via a future `reset` tool or manual SIGUSR1)
Then   the server does not throw "ENOENT" for its own CWD
  And  the server continues responding to tools/list after the reset
```

#### TC-INODE-02 — SQLite DB is recreated after reset

```
Given  the server completes an internal reset
When   client calls task_status {}
Then   the server responds with an empty task board (not an error)
```

---

### 4. Tool: `orchestrate`

#### TC-ORCH-01 — happy path, single task

```
Given  an initialized MCP session
When   client calls tools/call { name: "orchestrate", arguments: { prompt: "Add a hello() function to src/utils.js" } }
Then   result.content[0].text is valid JSON
  And  parsed JSON has { summary: {...}, tasks: [...] }
  And  tasks array has at least one entry with { id, title, status, assigned_to }
  And  status for all tasks is one of: pending, running, done, failed
```

#### TC-ORCH-02 — agent routing follows 70/30 quota (gemini/claude)

```
Given  100 tasks are submitted over multiple orchestrate calls
Then   ~70% are assigned to "gemini"
  And  ~30% are assigned to "claude-code"
  And  no task is assigned to an unknown agent
```

#### TC-ORCH-03 — missing prompt returns error

```
Given  an initialized MCP session
When   client calls tools/call { name: "orchestrate", arguments: {} }
Then   result.isError is true
  And  result.content[0].text contains "prompt"
```

#### TC-ORCH-04 — concurrent orchestrate calls

```
Given  an initialized MCP session
When   two orchestrate calls are sent concurrently (different request IDs)
Then   both receive valid responses without deadlock
  And  task IDs do not collide between the two calls
```

---

### 5. Tool: `task_status`

#### TC-STATUS-01 — all tasks board (no id)

```
Given  at least one task exists
When   client calls tools/call { name: "task_status", arguments: {} }
Then   result contains { summary: { total, pending, running, done, failed }, tasks: [...] }
```

#### TC-STATUS-02 — single task by id

```
Given  task T1 exists
When   client calls tools/call { name: "task_status", arguments: { id: "T1" } }
Then   result.task.id === "T1"
  And  result.task has fields: id, title, status, assigned_to, created_at
```

#### TC-STATUS-03 — unknown task id returns error

```
Given  task "T999" does not exist
When   client calls tools/call { name: "task_status", arguments: { id: "T999" } }
Then   result.isError is true  OR  result.task is null
```

---

### 6. Tool: `task_diff`

#### TC-DIFF-01 — happy path for completed task

```
Given  task T1 has status "done" and a worktree with changes
When   client calls tools/call { name: "task_diff", arguments: { id: "T1" } }
Then   result contains { task_id: "T1", files_changed: [...], diff: "..." }
  And  diff is a valid unified diff string
```

#### TC-DIFF-02 — no changes returns empty diff

```
Given  task T1 worktree has no file changes vs main
When   client calls task_diff { id: "T1" }
Then   result.diff === ""  AND  result.files_changed is []
```

#### TC-DIFF-03 — missing id returns error

```
When   client calls task_diff without id argument
Then   result.isError is true
```

---

### 7. Tool: `task_accept`

#### TC-ACCEPT-01 — happy path merge

```
Given  task T1 has status "done"
When   client calls task_accept { id: "T1" }
Then   result.task_id === "T1"
  And  the task branch is merged into main
  And  the worktree is cleaned up
  And  task status becomes "accepted"
```

#### TC-ACCEPT-02 — accept a non-done task returns error

```
Given  task T1 has status "running"
When   client calls task_accept { id: "T1" }
Then   result.isError is true
  And  error message references task status
```

---

### 8. Tool: `task_reject`

#### TC-REJECT-01 — happy path re-queue

```
Given  task T1 has status "done"
When   client calls task_reject { id: "T1", reason: "Missing unit tests" }
Then   result.task_id === "T1"
  And  result.status === "pending"
  And  result.message contains "Re-queued"
  And  task description is appended with the rejection reason
```

#### TC-REJECT-02 — missing reason returns error

```
When   client calls task_reject { id: "T1" } (no reason)
Then   result.isError is true
```

---

### 9. Tool: `task_logs`

#### TC-LOGS-01 — happy path with default tail

```
Given  task T1 has a running or completed container
When   client calls task_logs { id: "T1" }
Then   result.task_id === "T1"
  And  result contains log lines (up to 100)
```

#### TC-LOGS-02 — custom tail parameter

```
When   client calls task_logs { id: "T1", tail: 10 }
Then   result contains at most 10 log lines
```

#### TC-LOGS-03 — no container for task

```
Given  task T1 has no associated container
When   client calls task_logs { id: "T1" }
Then   result contains empty logs or informative message (not a crash)
```

---

### 10. Tool: `task_kill`

#### TC-KILL-01 — happy path kill running container

```
Given  task T1 has status "running" with an active container
When   client calls task_kill { id: "T1" }
Then   result.task_id === "T1"
  And  the Docker container is stopped
  And  task status becomes "failed"
```

#### TC-KILL-02 — kill non-running task

```
Given  task T1 has status "done"
When   client calls task_kill { id: "T1" }
Then   result indicates no container to kill (not a crash)
```

---

### 11. Tool: `workforce_status`

#### TC-WORKFORCE-01 — happy path no containers

```
Given  no worker containers are running
When   client calls workforce_status {}
Then   result contains { containers: [], summary: { total, pending, running, done, failed } }
```

#### TC-WORKFORCE-02 — happy path with running containers

```
Given  at least one worker container is active
When   client calls workforce_status {}
Then   result.containers is a non-empty array
  And  each container entry has { id, name, status, ... }
```

---

### 12. Error Handling & Edge Cases

#### TC-ERR-01 — unknown tool name

```
When   client calls tools/call { name: "nonexistent_tool", arguments: {} }
Then   result.isError is true
  And  error message contains "Unknown tool"
```

#### TC-ERR-02 — malformed JSON on stdin

```
When   client sends a line that is not valid JSON
Then   server does not crash
  And  server returns a JSON-RPC parse error response
```

#### TC-ERR-03 — server survives orchestrator init failure

```
Given  PROJECT_ROOT points to an invalid path
When   server starts and orchestrator.initialize() rejects
Then   server exits with code 1
  And  stderr contains "Orchestrator init failed"
```

---

## Test Matrix Summary

| Tool             | Happy Path | Error Cases | Edge Cases |
|------------------|-----------|-------------|------------|
| orchestrate      | TC-ORCH-01 | TC-ORCH-03  | TC-ORCH-02, TC-ORCH-04 |
| task_status      | TC-STATUS-01, TC-STATUS-02 | TC-STATUS-03 | — |
| task_diff        | TC-DIFF-01 | TC-DIFF-03  | TC-DIFF-02 |
| task_accept      | TC-ACCEPT-01 | TC-ACCEPT-02 | — |
| task_reject      | TC-REJECT-01 | TC-REJECT-02 | — |
| task_logs        | TC-LOGS-01 | — | TC-LOGS-02, TC-LOGS-03 |
| task_kill        | TC-KILL-01 | — | TC-KILL-02 |
| workforce_status | TC-WORKFORCE-01, TC-WORKFORCE-02 | — | — |
| Startup/Guard    | TC-STARTUP-01–03 | TC-GUARD-01–03 | TC-INODE-01–02 |
| Protocol errors  | — | TC-ERR-01–03 | — |
