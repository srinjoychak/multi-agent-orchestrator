#!/bin/bash
# deploy-agy-squad.sh — Install Agy-VN-Squad skills globally or into a target project
#
# Usage:
#   bash agy-vnsq/scripts/deploy-agy-squad.sh              # global install to ~/.gemini/
#   bash agy-vnsq/scripts/deploy-agy-squad.sh <project>    # install into <project>/.gemini/
#
# Antigravity CLI needs no packaging/zip step: skills are plain directories
# under a `skills/` folder, auto-discovered without any reload step.
#
# IMPORTANT: despite Antigravity's own bundled docs describing `~/.agents/`
# as the customization root, that location was tested live and does NOT
# actually get discovered (confirmed with a real installed skill sitting
# there that `agy` reported as unavailable). The location that DOES work,
# confirmed by live testing, is `~/.gemini/skills/` — the legacy Gemini CLI
# skill-install path that Antigravity still scans for backward
# compatibility. This script targets that confirmed-working location, not
# the documented-but-non-functional one.

set -e

REPO="$(git rev-parse --show-toplevel)"
SKILLS_DIR="$REPO/agy-vnsq/skills"
GLOBAL_DIR="$HOME/.gemini"

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
    DEST_DIR="$TARGET_DIR/.gemini"
    echo "Installing to workspace: $TARGET_DIR"
    echo "NOTE: workspace-scoped discovery has not been confirmed via live testing"
    echo "      (only global ~/.gemini/skills/ was verified). If skills don't show"
    echo "      up here, use a global install instead."
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
echo "No reload step needed — Antigravity CLI re-scans on session start."
echo ""
echo "Verify with: agy -p \"Do you have a skill called vn-agy?\" --dangerously-skip-permissions"
