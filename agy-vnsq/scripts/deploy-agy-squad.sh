#!/bin/bash
# deploy-agy-squad.sh — Install Agy-VN-Squad skills globally or into a target project
#
# Usage:
#   bash agy-vnsq/scripts/deploy-agy-squad.sh              # global install to ~/.agents/
#   bash agy-vnsq/scripts/deploy-agy-squad.sh <project>    # install into <project>/.agents/
#
# Unlike the old Gemini CLI, Antigravity CLI needs no packaging/zip step: skills
# are plain directories under a `skills/` folder in a customization root
# (`~/.agents/` globally, `<project>/.agents/` per-workspace), auto-discovered
# on every session start. See agy-vnsq/AGENTS.md for background.

set -e

REPO="$(git rev-parse --show-toplevel)"
SKILLS_DIR="$REPO/agy-vnsq/skills"
GLOBAL_DIR="$HOME/.agents"

echo "Agy-VN-Squad — Deploy"
echo "Source: $REPO/agy-vnsq"
echo ""

# Ensure scripts are executable
chmod +x "$REPO/agy-vnsq/scripts/"*-ask.js

# ── Global or Project Installation ─────────────────────────────────────────────

SCOPE="global"
if [ -n "$1" ]; then
    TARGET_DIR="$1"
    if [ ! -d "$TARGET_DIR" ]; then
        echo "ERROR: directory not found: $TARGET_DIR"
        exit 1
    fi
    SCOPE="workspace"
    DEST_DIR="$TARGET_DIR/.agents"
    echo "Installing to workspace: $TARGET_DIR"
else
    DEST_DIR="$GLOBAL_DIR"
    echo "Installing globally to $GLOBAL_DIR"
fi

# Install skills — materialize each skill directory into the customization root
mkdir -p "$DEST_DIR/skills"
for skill_path in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_path")
  echo "Installing skill: $skill_name ($SCOPE scope)"
  rm -rf "${DEST_DIR:?}/skills/$skill_name"
  cp -r "$skill_path" "$DEST_DIR/skills/$skill_name"
done

# Copy worker scripts alongside the customization root
echo "Copying worker scripts to $DEST_DIR/scripts/ ..."
mkdir -p "$DEST_DIR/scripts"
cp "$REPO/agy-vnsq/scripts/"*-ask.js "$DEST_DIR/scripts/"
echo "      Worker scripts installed"

echo ""
echo "Agy-VN-Squad deploy complete."
echo "No reload step needed — Antigravity CLI re-scans customization roots on session start."
