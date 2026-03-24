# Linux / macOS Setup Guide

> **Agent note:** This file documents Linux/macOS setup for the Multi-Agent Orchestrator.
> If you are running on Windows, see `platform/windows/README.md` instead.
> Ubuntu WSL users: follow this guide (WSL runs as Linux).

---

## Requirements

| Requirement | Version | How to check |
|-------------|---------|-------------|
| Node.js | 20+ | `node --version` |
| Git | 2.5+ | `git --version` |
| Claude Code | latest | `claude --version` |
| Gemini CLI | latest | `gemini --version` |

---

## Install Node.js 20+ (if not present)

```bash
# Ubuntu / Debian (including WSL)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS
brew install node@20
```

---

## Install AI CLIs

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @google/gemini-cli
```

Authenticate:

```bash
claude auth login
gemini auth login
```

---

## Linux CLI Resolution

On Linux/macOS, npm global CLIs are plain shell executables (no `.cmd` wrapper needed).
`execFile('claude', ...)` resolves correctly without any routing.

The `IS_WINDOWS` guard in `platform/detect.js` is `false` on Linux — no `cmd.exe` routing occurs.

---

## Ubuntu WSL Workflow

WSL shares the Windows filesystem at `/mnt/c/`. The same repo is accessible from both
Windows and WSL, making it ideal for cross-platform testing without a second machine.

```bash
# Open the project in WSL
cd /mnt/c/Users/<user>/path/to/copilot_adapter

# Install dependencies (separate node_modules from Windows install)
npm install

# Run tests — exercises Linux code paths
npm test
```

> **Important:** Run `npm install` from within WSL even if you already installed on Windows.
> Linux and Windows use different native binary builds for some packages.

---

## Verify Setup

```bash
npm run check-agents
npm test
```

---

## Running the Orchestrator

```bash
node src/orchestrator/index.js decompose "Build a REST API with auth and tests"
node src/orchestrator/index.js run "Build a REST API with auth and tests"
```

---

## Known Linux/macOS Differences from Windows

| Behaviour | Linux/Mac | Windows |
|-----------|-----------|---------|
| CLI resolution | Direct `execFile('claude')` | Routed via `cmd.exe /c claude` |
| `SIGTERM` in `abort()` | Works correctly | May not terminate child process |
| File paths | `/path/to/file` | `C:\path\to\file` (normalised by `node:path`) |
| Git worktrees | Works identically | Works identically |
| Test suite | All 141 tests should pass | All 141 tests pass |

---

## Testing

```bash
# All tests
npm test

# Unit only (no CLI required)
npm run test:unit

# Integration (requires claude + gemini in PATH)
npm run test:integration
```

---

## Troubleshooting

**`claude: command not found`**
- Check npm global bin is in PATH: `npm bin -g` then add to `~/.bashrc` or `~/.zshrc`
- Or use: `export PATH="$(npm bin -g):$PATH"`

**WSL: git operations fail**
- Ensure you are operating on the Linux filesystem for best git performance
- If on `/mnt/c/...`, git may be slow due to filesystem translation — this is expected
- Worktree creation still works correctly

**Permission errors**
- The orchestrator passes `--dangerously-skip-permissions` to claude automatically
- For Gemini, `--yolo` auto-approves all tool actions
