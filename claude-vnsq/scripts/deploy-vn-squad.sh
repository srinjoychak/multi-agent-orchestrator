#!/bin/bash
# deploy-vn-squad.sh — Install VN-Squad v2 skills globally or into a target project
#
# Usage:
#   bash scripts/deploy-vn-squad.sh              # global install to ~/.claude/
#   bash scripts/deploy-vn-squad.sh <project>    # also deploy to <project>

set -e

REPO="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)/claude-vnsq"
GLOBAL_DIR="$HOME/.claude"

echo "VN-Squad v2 — Deploy"
echo "Source: $REPO"
echo ""

# ── Global install ─────────────────────────────────────────────────────────────

echo "[1/4] Installing skills to $GLOBAL_DIR/commands/ ..."
mkdir -p "$GLOBAL_DIR/commands"
cp "$REPO/.claude/commands/"*.md "$GLOBAL_DIR/commands/"
echo "      $(ls "$REPO/.claude/commands/"*.md | wc -l) skills installed"

echo "[2/4] Installing agents to $GLOBAL_DIR/agents/ ..."
mkdir -p "$GLOBAL_DIR/agents"
cp "$REPO/.claude/agents/"*.md "$GLOBAL_DIR/agents/"
# Patch gemini-worker path for global use: fallback to ~/.claude/scripts/
sed -i 's|node /path/to/scripts/gemini-ask.js|node ~/.claude/scripts/gemini-ask.js|g' \
    "$GLOBAL_DIR/agents/gemini-worker.md"
# Also patch the git-root-relative instruction
sed -i 's|git rev-parse --show-toplevel.*then append .*/scripts/gemini-ask.js.*|Use: ~/.claude/scripts/gemini-ask.js (global install) or <project>/scripts/gemini-ask.js if present.|g' \
    "$GLOBAL_DIR/agents/gemini-worker.md"
echo "      $(ls "$REPO/.claude/agents/"*.md | wc -l) agents installed"

echo "[3/4] Installing Gemini adapter to $GLOBAL_DIR/scripts/ ..."
mkdir -p "$GLOBAL_DIR/scripts"
cp "$(dirname "$REPO")/scripts/gemini-ask.js" "$GLOBAL_DIR/scripts/"
cp "$(dirname "$REPO")/config/gemini-settings.json" "$GLOBAL_DIR/scripts/"
echo "      gemini-ask.js + gemini-settings.json installed"

echo "[4/4] Writing global CLAUDE.md ..."
cat > "$GLOBAL_DIR/CLAUDE.md" << 'CLAUDEEOF'
# VN-Squad v2 — Global Tech Lead Instructions

You are the **Tech Lead**. Your job is to coordinate, not implement.
Use skills and collaborators — don't write all the code yourself.

## Skills (available in every project)

| Skill | When to use |
|---|---|
| `/plan <task>` | Decompose any non-trivial task into TDD steps before starting |
| `/dispatch <tasks>` | Run 3+ independent tasks in parallel via subagents |
| `/scaffold <task>` | Decompose a complex or repeatedly-failing task into tiered subtasks |
| `/argue <topic>` | Debate a design with Codex before writing code |
| `/gemini <prompt>` | Research, analysis, or large-context tasks via Gemini CLI |
| `/codex:rescue <task>` | Delegate an implementation or fix to Codex |
| `/codex:adversarial-review` | Get Codex's adversarial critique of the current diff |
| `/review` | Dispatch a Claude Code reviewer subagent |
| `/worktrees` | Create isolated git worktrees for parallel work |
| `/finish` | Test-verified merge, PR, or discard of a branch |
| `/verify` | Gate: run actual verification before claiming completion |

## Recommended Workflow

```
1. /plan <task>               → structured TDD steps
2. /argue <design question>   → agree on design before coding
3. /dispatch [agent] tasks    → parallel agents
   ↳ if task fails 2+ times: /scaffold → tier it, then re-dispatch
4. /verify                    → gate before claiming done
5. /review                    → reviewer subagent
6. /finish                    → merge or PR
```

## Agents Available

- **claude-subagent** — Task tool subagents (code, test, refactor, debug, review)
- **gemini-worker** — Gemini CLI via ~/.claude/scripts/gemini-ask.js
- **codex-worker** — Codex via codex-plugin-cc
- **vn-reviewer** — Read-only structured code reviewer

## Global Rules

- Never commit directly to master/main
- Run /verify before every /finish
- Sign PR reviews: — Claude Sonnet 4.6 (Tech Lead)
- Read AGENTS.md in the project root for subagent prompt standards (if present)

## Gemini Script Location

Global install: ~/.claude/scripts/gemini-ask.js
Project override: <project-root>/scripts/gemini-ask.js (takes precedence if present)
CLAUDEEOF
echo "      ~/.claude/CLAUDE.md written"

echo ""
echo "Global install complete."
echo ""

# ── Optional project deploy ────────────────────────────────────────────────────

if [ -n "$1" ]; then
    TARGET="$1"
    echo "Deploying to project: $TARGET"

    if [ ! -d "$TARGET" ]; then
        echo "ERROR: directory not found: $TARGET"
        exit 1
    fi

    echo "[A] Copying skills to $TARGET/.claude/commands/ ..."
    mkdir -p "$TARGET/.claude/commands"
    cp "$REPO/.claude/commands/"*.md "$TARGET/.claude/commands/"

    echo "[B] Copying agents to $TARGET/.claude/agents/ ..."
    mkdir -p "$TARGET/.claude/agents"
    cp "$REPO/.claude/agents/"*.md "$TARGET/.claude/agents/"

    echo "[C] Copying Gemini adapter to $TARGET/scripts/ ..."
    mkdir -p "$TARGET/scripts"
    cp "$(dirname "$REPO")/scripts/gemini-ask.js" "$TARGET/scripts/"
    mkdir -p "$TARGET/config"
    cp "$(dirname "$REPO")/config/gemini-settings.json" "$TARGET/config/"

    echo ""
    echo "Project deploy complete: $TARGET"
    echo "Next: add a minimal CLAUDE.md to $TARGET/ with project-specific constraints."
fi

echo ""
echo "Verify with:"
echo "  node ~/.claude/scripts/gemini-ask.js 'what is 2+2'"
echo "  ls ~/.claude/commands/"
echo "  ls ~/.claude/agents/"
