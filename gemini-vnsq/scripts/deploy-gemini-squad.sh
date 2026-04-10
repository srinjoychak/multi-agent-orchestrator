#!/bin/bash
# deploy-gemini-squad.sh — Install Gemini-VN-Squad skills globally or into a target project
#
# Usage:
#   bash gemini-vnsq/scripts/deploy-gemini-squad.sh              # global install to ~/.gemini/
#   bash gemini-vnsq/scripts/deploy-gemini-squad.sh <project>    # also deploy to <project>

set -e

# Pre-flight checks
if ! command -v zip &> /dev/null; then
    echo "ERROR: 'zip' utility is not installed."
    echo "Install with: sudo apt-get install zip"
    exit 1
fi

REPO="$(git rev-parse --show-toplevel)"
PACKAGE_TOOL="/home/srinjcha/.nvm/versions/node/v24.14.0/lib/node_modules/@google/gemini-cli/bundle/builtin/skill-creator/scripts/package_skill.cjs"
GLOBAL_DIR="$HOME/.gemini"

echo "Gemini-VN-Squad — Deploy"
echo "Source: $REPO/gemini-vnsq"
echo ""

# Ensure scripts are executable
chmod +x "$REPO/gemini-vnsq/scripts/"*-ask.js

# Setup dist directory
DIST_DIR="$REPO/gemini-vnsq/dist"
mkdir -p "$DIST_DIR"

# ── Global or Project Installation ─────────────────────────────────────────────

SCOPE="global"
if [ -n "$1" ]; then
    TARGET_DIR="$1"
    if [ ! -d "$TARGET_DIR" ]; then
        echo "ERROR: directory not found: $TARGET_DIR"
        exit 1
    fi
    SCOPE="workspace"
    echo "Installing to workspace: $TARGET_DIR"
else
    echo "Installing globally to $GLOBAL_DIR"
fi

# Package and install skills
SKILLS_DIR="$REPO/gemini-vnsq/skills"

for skill_path in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_path")
  echo "Packaging skill: $skill_name"
  node "$PACKAGE_TOOL" "$skill_path" "$DIST_DIR"
  
  echo "Installing skill: $skill_name ($SCOPE scope)"
  if [ "$SCOPE" = "workspace" ]; then
    # Change dir to target for workspace install
    (cd "$TARGET_DIR" && gemini skills install "$DIST_DIR/$skill_name.skill" --scope workspace --consent)
  else
    gemini skills install "$DIST_DIR/$skill_name.skill" --scope user --consent
  fi
done

# Copy worker scripts to global location if global install
if [ "$SCOPE" = "global" ]; then
    echo "Copying worker scripts to $GLOBAL_DIR/scripts/ ..."
    mkdir -p "$GLOBAL_DIR/scripts"
    cp "$REPO/gemini-vnsq/scripts/"*-ask.js "$GLOBAL_DIR/scripts/"
    echo "      Worker scripts installed"
fi

echo ""
echo "Gemini-VN-Squad deploy complete."
echo "You MUST execute '/skills reload' in your interactive Gemini CLI session."
