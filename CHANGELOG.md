# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-24

### Added
- **MCP Server:** Introduced a Model Context Protocol (MCP) server as the primary interface.
  - Exposed 8 tools: `orchestrate`, `task_status`, `task_diff`, `task_accept`, `task_reject`, `task_logs`, `task_kill`, and `workforce_status`.
- **Docker Worker Isolation:** Worker agents (Claude Code, Gemini CLI) now execute within isolated Docker containers.
  - Provides real TTY support, eliminating subprocess hanging and stdin issues.
  - Standardized environments via `Dockerfile.gemini` and `Dockerfile.claude`.
- **SQLite Task Management:** Replaced file-based `tasks.json` with a SQLite database (`better-sqlite3`).
  - Added `src/taskmanager/schema.sql` for robust task state tracking.
  - Improved concurrency support for parallel agent execution.
- **Worktree Manager:** Dedicated module for managing git worktrees, ensuring task isolation and clean merges.
- **Agent Router:** New routing logic for assigning tasks based on agent capabilities, quotas, and token budgets.
- **Docker Orchestration:** Added `docker-compose.yml` for full stack deployment, including the orchestrator MCP server and worker configurations.
- **Token Tracking:** Added infrastructure for tracking token usage per task and per agent.

### Changed
- **Architecture Pivot:** Moved from a subprocess-based CLI execution model to an MCP-native service architecture.
- **Orchestrator Core:** Rewritten `src/orchestrator/core.js` to utilize the new Docker runner, SQLite task manager, and worktree manager.
- **Task Manager:** Refactored `src/taskmanager/index.js` to use SQLite transactions instead of manual file locking.
- **Agent Configuration:** Updated `agents.json` with Docker image specifications and token budget settings.

### Removed
- **Subprocess Adapters:** Deleted v1 adapters and subprocess management logic.
- **Legacy CLI Verbs:** Removed step-based CLI handlers (decompose, assign, execute, etc.) in favor of MCP tools.
- **Windows-Specific Code:** Deprecated `platform/detect.js` and other OS-specific abstractions, standardizing on Linux-native Docker execution.
- **File-Based Comms:** Removed `src/comms/file-channel.js` and related JSON-locking mechanisms.

## [2.0.0] - 2026-03-21
*Internal Milestone - v2 Design (MCP + Subprocesses)*

## [1.0.0] - 2026-03-19
*Initial Release - Subprocess-based Multi-Agent Orchestrator*
