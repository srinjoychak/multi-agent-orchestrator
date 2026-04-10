#!/bin/bash
# uninstall-gemini-squad.sh — Remove Gemini-VN-Squad skills and worker scripts
#
# Usage:
#   bash gemini-vnsq/scripts/uninstall-gemini-squad.sh              # global uninstall
#   bash gemini-vnsq/scripts/uninstall-gemini-squad.sh <project>    # workspace uninstall

set -e

REPO="$(git rev-parse --show-toplevel)"
GLOBAL_DIR="$HOME/.gemini"
SKILLS_DIR="$REPO/gemini-vnsq/skills"

echo "Gemini-VN-Squad — Uninstall"
echo ""

# ── Global or Project Uninstallation ───────────────────────────────────────────

SCOPE="global"
if [ -n "$1" ]; then
    TARGET_DIR="$1"
    if [ ! -d "$TARGET_DIR" ]; then
        echo "ERROR: directory not found: $TARGET_DIR"
        exit 1
    fi
    SCOPE="workspace"
    echo "Uninstalling from workspace: $TARGET_DIR"
else
    echo "Uninstalling from global scope"
fi

# Uninstall skills
for skill_path in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_path")
  
  echo "Uninstalling skill: $skill_name ($SCOPE scope)"
  if [ "$SCOPE" = "workspace" ]; then
    (cd "$TARGET_DIR" && gemini skills uninstall "$skill_name" --scope workspace || true)
  else
    gemini skills uninstall "$skill_name" --scope user || true
  fi
done

# Remove worker scripts if global uninstall
if [ "$SCOPE" = "global" ]; then
    echo "Removing worker scripts from $GLOBAL_DIR/scripts/ ..."
    rm -f "$GLOBAL_DIR/scripts/claude-ask.js"
    rm -f "$GLOBAL_DIR/scripts/codex-ask.js"
    rm -f "$GLOBAL_DIR/scripts/gemini-ask.js"
    echo "      Worker scripts removed"
fi

# Optional: Clean up dist directory
DIST_DIR="$REPO/gemini-vnsq/dist"
if [ -d "$DIST_DIR" ]; then
    echo "Cleaning up $DIST_DIR ..."
    rm -rf "$DIST_DIR"
fi

echo ""
echo "Gemini-VN-Squad uninstall complete."
echo "You MUST execute '/skills reload' in your interactive Gemini CLI session."
