# Contributing Guidelines

Thank you for your interest in contributing to the Multi-Agent Orchestrator! This project coordinates multiple AI coding agents (Claude Code, Gemini CLI) to work together as a team.

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20+**
- **Git 2.5+** (for git worktree support)
- **Docker** (for isolated agent execution)
- **AI CLI agents** (at least one of):
  - [Claude Code](https://github.com/anthropic-ai/claude-code)
  - [Gemini CLI](https://github.com/google/gemini-cli)

---

## Setup

1. **Fork and clone the repository:**
   ```bash
   git clone <your-fork-url>
   cd multi-agent-orchestrator
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Verify AI agents:**
   Ensure your AI CLI agents are installed and authenticated. You can use the project's build and validation scripts to ensure your environment is ready:
   ```bash
   npm run build:workers
   npm run validate
   ```

---

## Branching Strategy

We use a specific branching strategy to maintain isolation and parallel execution:

- **Main Branch (`main`):** Stable code, ready for release.
- **Agent Branches (`agent/<agent-name>/<task-id>`):** When the orchestrator assigns a task, it creates a dedicated git worktree on a fresh branch following this naming convention (e.g., `agent/gemini/T1`).

Contributors should generally work on feature branches (e.g., `feat/some-feature` or `fix/some-bug`) branching off `main`.

---

## Development Workflow

1. **Decompose and Assign:** Use the orchestrator to decompose requests into tasks and assign them to agents.
2. **Implementation:** Agents work in isolated git worktrees.
3. **Review:** The Tech Lead reviews task results and either accepts or rejects them.
4. **Merge:** Accepted branches are merged back into `main`.

When contributing code changes (e.g., to the orchestrator core or adapters), ensure you follow the existing ES module syntax (`import`/`export`) and architectural patterns.

---

## Running Tests

All contributions must pass the existing test suite. Use the following commands to run tests:

- **Run all tests:**
  ```bash
  npm test
  ```
- **Run unit tests:**
  ```bash
  npm run test:unit
  ```
- **Run integration tests:**
  ```bash
  npm run test:integration
  ```

Add new tests for any features or bug fixes you introduce.

---

## Pull Request Process

1. **Create a feature branch:**
   ```bash
   git checkout -b <type>/<description>
   ```
2. **Commit your changes:** Follow clear, concise commit message conventions.
3. **Run tests:** Ensure all tests pass.
4. **Submit a PR:** Provide a clear description of your changes and reference any related issues.
5. **Review:** Your PR will be reviewed by the maintainers. Address any feedback before merging.

---

## Architectural Principles

- **Token Optimization:** Always prioritize strategies that minimize token usage.
- **Isolation:** Agents must run in Docker containers with dedicated git worktrees.
- **Observability:** Ensure all processes are logged and monitorable.

For a deeper dive into the system design, see [ARCHITECTURE.md](ARCHITECTURE.md) and [DESIGN.md](DESIGN.md).
