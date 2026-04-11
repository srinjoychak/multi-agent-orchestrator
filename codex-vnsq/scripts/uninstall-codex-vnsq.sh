#!/bin/bash
# uninstall-codex-vnsq.sh — Remove Codex-VN-Squad skills and worker scripts

set -euo pipefail

GLOBAL_DIR="${CODEX_HOME:-$HOME/.codex}"

echo "Codex-VN-Squad — Uninstall"
echo

if [ -n "${1:-}" ]; then
    TARGET_DIR="$1"
    if [ ! -d "$TARGET_DIR" ]; then
        echo "ERROR: directory not found: $TARGET_DIR"
        exit 1
    fi
    INSTALL_DIR="$TARGET_DIR/.codex"
    echo "Uninstalling from workspace: $TARGET_DIR"
else
    INSTALL_DIR="$GLOBAL_DIR"
    echo "Uninstalling from global scope"
fi

rm -rf "$INSTALL_DIR/skills/vn-plan"
rm -rf "$INSTALL_DIR/skills/vn-dispatch"
rm -rf "$INSTALL_DIR/skills/vn-scaffold"
rm -rf "$INSTALL_DIR/skills/vn-argue"
rm -rf "$INSTALL_DIR/skills/vn-gemini"
rm -rf "$INSTALL_DIR/skills/vn-claude"
rm -rf "$INSTALL_DIR/skills/vn-worktrees"
rm -rf "$INSTALL_DIR/skills/vn-finish"
rm -rf "$INSTALL_DIR/skills/vn-verify"
rm -rf "$INSTALL_DIR/skills/vn-review"

rm -f "$INSTALL_DIR/scripts/codex-ask.js"
rm -f "$INSTALL_DIR/scripts/claude-ask.js"
rm -f "$INSTALL_DIR/scripts/gemini-ask.js"
rm -f "$INSTALL_DIR/scripts/vn-dispatch.js"
rm -f "$INSTALL_DIR/scripts/deploy-codex-vnsq.sh"
rm -f "$INSTALL_DIR/scripts/uninstall-codex-vnsq.sh"
rm -f "$INSTALL_DIR/AGENTS.md"
rm -f "$INSTALL_DIR/README.md"
rm -f "$INSTALL_DIR/TEST-PLAN.md"
rm -f "$INSTALL_DIR/config/gemini-settings.json"
rm -rf "$INSTALL_DIR/codex-vnsq"

rmdir "$INSTALL_DIR/skills" 2>/dev/null || true
rmdir "$INSTALL_DIR/scripts" 2>/dev/null || true
rmdir "$INSTALL_DIR/config" 2>/dev/null || true
rmdir "$INSTALL_DIR" 2>/dev/null || true

echo
echo "Codex-VN-Squad uninstall complete."
