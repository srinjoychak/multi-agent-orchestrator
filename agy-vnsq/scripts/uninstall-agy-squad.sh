#!/bin/bash
# uninstall-agy-squad.sh — Remove Agy-VN-Squad skills and worker scripts
#
# Usage:
#   bash agy-vnsq/scripts/uninstall-agy-squad.sh              # global uninstall
#   bash agy-vnsq/scripts/uninstall-agy-squad.sh <project>    # workspace uninstall

set -e

REPO="$(git rev-parse --show-toplevel)"
SKILLS_DIR="$REPO/agy-vnsq/skills"
GLOBAL_DIR="$HOME/.agents"

echo "Agy-VN-Squad — Uninstall"
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
    DEST_DIR="$TARGET_DIR/.agents"
    echo "Uninstalling from workspace: $TARGET_DIR"
else
    DEST_DIR="$GLOBAL_DIR"
    echo "Uninstalling from global scope"
fi

# Remove skills
for skill_path in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_path")
  echo "Removing skill: $skill_name ($SCOPE scope)"
  rm -rf "${DEST_DIR:?}/skills/$skill_name"
done

# Remove worker scripts
echo "Removing worker scripts from $DEST_DIR/scripts/ ..."
rm -f "$DEST_DIR/scripts/claude-ask.js"
rm -f "$DEST_DIR/scripts/codex-ask.js"
rm -f "$DEST_DIR/scripts/agy-ask.js"
echo "      Worker scripts removed"

echo ""
echo "Agy-VN-Squad uninstall complete."
