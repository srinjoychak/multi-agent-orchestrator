# Setup Guide

Complete environment setup for the Multi-Agent Orchestrator.

---

## 1. Node.js 20+

The project uses ES modules and `node:` built-ins that require Node.js 20 or later.

**Check your version:**

```bash
node --version
# Must be v20.0.0 or higher
```

**Install / upgrade:**

- **Windows**: Download the LTS installer from [nodejs.org](https://nodejs.org), or use [nvm-windows](https://github.com/coreybutler/nvm-windows):
  ```powershell
  nvm install 20
  nvm use 20
  ```
- **macOS**: `brew install node@20`
- **Linux**: Use [nvm](https://github.com/nvm-sh/nvm):
  ```bash
  nvm install 20 && nvm use 20
  ```

---

## 2. Git 2.5+

Git worktree support (required) was added in Git 2.5.

**Check your version:**

```bash
git --version
# Must be 2.5 or higher
```

**Install / upgrade:**

- **Windows**: Download from [git-scm.com](https://git-scm.com) — use "Git for Windows"
- **macOS**: `brew install git`
- **Linux**: `sudo apt install git` or your distro's package manager

> **Windows note**: After installing Git for Windows, open a new terminal to ensure `git` is available in `PATH`. If you use WSL, install Git inside WSL separately.

---

## 3. Claude Code CLI

### Installation

```bash
npm install -g @anthropic-ai/claude-code
```

### Authentication

```bash
claude
# Follow the interactive login flow — opens a browser to authenticate with your Anthropic account
```

### Verify

```bash
claude --version
claude -p "Say hello" --output-format json
```

The second command should return a JSON response. If it hangs or fails, re-run `claude` and complete authentication.

> **Windows PATH issue**: If `claude` is not found after installation, check that your npm global bin directory is in `PATH`. Run `npm config get prefix` and ensure `<prefix>\bin` (Windows) or `<prefix>/bin` (Unix) is in your `PATH`.

---

## 4. Gemini CLI

### Installation

```bash
npm install -g @google/gemini-cli
```

### Authentication

```bash
gemini
# Follow the interactive login — authenticates with your Google account
```

### Verify

```bash
gemini --version
gemini -p "Say hello" --output-format json
```

> **Note**: Only one agent CLI is required to run the orchestrator. If only `claude` is installed, all tasks are handled by Claude Code. Having both unlocks true parallel execution.

---

## 5. Project Setup

### Clone the repository

```bash
git clone <repo-url>
cd copilot_adapter
```

### Install dependencies

```bash
npm install
```

The project uses minimal runtime dependencies — all heavy lifting is done by the CLI tools themselves.

---

## 6. Verification

### Check available agents

```bash
npm run check-agents
```

This runs `src/adapters/check.js` and reports which CLIs are found in `PATH`:

```
Checking available agents...
  [+] claude-code — available (v1.x.x)
  [+] gemini      — available (v0.x.x)

2 agent(s) ready.
```

### Run a smoke test

```bash
node src/orchestrator/index.js "Create a file called hello.txt with the content 'Hello from the orchestrator'"
```

Expected output sequence:

```
Initializing orchestrator...
  [+] claude-code — available
  [+] gemini — available
  2 agent(s) ready.

Step 1: Decomposing request into tasks...
  Created 1 tasks.

Step 2: Assigning tasks to agents...
  T1: "Create hello.txt" → claude-code

Step 3: Executing tasks in parallel...
  Executing T1 with claude-code...
...
=== Multi-Agent Orchestration Report ===
Completed: 1/1 tasks
```

---

## 7. Troubleshooting

### `claude` or `gemini` not found in PATH (Windows)

Run `npm config get prefix` and add the result's `\bin` folder to your system `PATH` via:

**System Properties → Environment Variables → System variables → Path → Edit**

Or for the current session only:

```powershell
$env:PATH += ";$(npm config get prefix)"
```

Restart your terminal after making permanent changes.

### Permission denied errors on Windows

If you see `EACCES` or `EPERM` errors creating worktrees or lock files:

1. Ensure you are not running inside a path protected by OneDrive sync or Antivirus real-time scan — these can lock files mid-write.
2. Run your terminal as Administrator for the initial test, then tighten permissions.
3. Move the project to a local path (e.g., `D:\projects\`) rather than a network or cloud-synced drive.

### Git worktree errors

```
fatal: 'agent/claude-code/T1' is already checked out
```

This means a previous run left a worktree behind. Clean up with:

```bash
git worktree list                        # see all worktrees
git worktree remove .worktrees/<name> --force
git branch -D agent/claude-code/T1
```

Or remove the entire `.worktrees/` directory and re-run.

### Lock file stuck

If the orchestrator crashes mid-run, `tasks.lock` may be left behind. The lock manager automatically breaks locks older than 30 seconds. If you need to force-clear immediately:

```bash
rm .agent-team/tasks.lock
```

### Task decomposition returns a single task

The planning step uses Claude Code to break your prompt into subtasks. Very simple prompts (e.g., "Create one file") will legitimately produce one task. If a multi-step prompt produces only one task, check the raw planner output in `.agent-team/session-log.json`.

### Both agents claim the same task

This should not happen — `TaskManager.claimTask()` uses file locking. If you observe it, check that your filesystem supports file-level locking (NFS shares and some network drives do not). Use a local filesystem path for `.agent-team/`.
