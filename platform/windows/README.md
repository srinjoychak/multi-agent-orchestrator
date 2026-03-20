# Windows Setup Guide

> **Agent note:** This file documents Windows-specific setup for the Multi-Agent Orchestrator.
> If you are running on Linux or macOS, see `platform/linux/README.md` instead.

---

## Requirements

| Requirement | Version | How to check |
|-------------|---------|-------------|
| Node.js | 20+ | `node --version` |
| Git | 2.5+ | `git --version` |
| Claude Code | latest | `claude --version` |
| Gemini CLI | latest | `gemini --version` |

---

## Install AI CLIs

```powershell
# Claude Code
npm install -g @anthropic-ai/claude-code

# Gemini CLI
npm install -g @google/gemini-cli
```

After installation, authenticate each CLI:

```powershell
claude auth login
gemini auth login
```

---

## Windows CLI Resolution — Why cmd.exe /c is Used

On Windows, npm global CLIs are installed as `.cmd` wrappers in `%APPDATA%\npm\`:

```
C:\Users\<user>\AppData\Roaming\npm\claude.cmd
C:\Users\<user>\AppData\Roaming\npm\gemini.cmd
```

Node.js `child_process.execFile()` cannot spawn `.cmd` files directly (ENOENT on Windows).
The orchestrator routes all CLI spawns through `cmd.exe /c <command>` automatically via
`platform/detect.js → platformExec()`.

**No manual action needed** — this is handled transparently.

---

## Verify Setup

```powershell
# Check both agents are detected
npm run check-agents

# Run the test suite
npm test
```

Expected output:
```
✓ claude-code: available
✓ gemini: available
141 passing, 0 failing
```

---

## Running the Orchestrator

```powershell
# Decompose a task
node src/orchestrator/index.js decompose "Build a REST API with auth and tests"

# Run autonomously (v1 mode)
node src/orchestrator/index.js run "Build a REST API with auth and tests"
```

---

## Known Windows-Specific Behaviours

| Behaviour | Impact | Notes |
|-----------|--------|-------|
| `.cmd` wrapper routing via `cmd.exe /c` | Transparent | Handled in `platform/detect.js` |
| `SIGTERM` in `abort()` does not kill processes on Windows | Minor | Use Task Manager or `taskkill /PID` if needed |
| Path separators in prompts | None | Node `path.join` normalises these |
| Git worktrees on NTFS | Works | Tested on Windows 11 |

---

## Testing on Windows

```powershell
# Unit tests only (no CLI required)
npm run test:unit

# Integration tests (requires claude + gemini in PATH)
npm run test:integration
```

Integration tests that require CLI binaries are automatically **skipped** if the binary
is not found in PATH — you will see `# skip` in the output, not a failure.

---

## Troubleshooting

**`ENOENT` when spawning claude or gemini**
- Run `where claude` — if not found, npm global dir is not in PATH
- Add `%APPDATA%\npm` to your `PATH` environment variable
- Restart your terminal after changing PATH

**Permission denied errors in Claude worktrees**
- The orchestrator passes `--dangerously-skip-permissions` to claude automatically
- This is safe because each task runs in an isolated git worktree branch

**Git worktree creation fails**
- Ensure you are inside a git repository (`git status` should succeed)
- Ensure Git 2.5+ is installed (`git --version`)
