#!/bin/bash
# deploy-codex-vnsq.sh — Install Codex-VN-Squad skills globally or into a target project
#
# Usage:
#   bash codex-vnsq/scripts/deploy-codex-vnsq.sh
#   bash codex-vnsq/scripts/deploy-codex-vnsq.sh <project>

set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
GLOBAL_DIR="${CODEX_HOME:-$HOME/.codex}"
SOURCE_DIR="$REPO/codex-vnsq"

echo "Codex-VN-Squad — Deploy"
echo "Source: $SOURCE_DIR"
echo

chmod +x "$REPO/codex-vnsq/scripts/"*-ask.js

SCOPE="global"
if [ -n "${1:-}" ]; then
    TARGET_DIR="$1"
    if [ ! -d "$TARGET_DIR" ]; then
        echo "ERROR: directory not found: $TARGET_DIR"
        exit 1
    fi
    SCOPE="workspace"
    INSTALL_DIR="$TARGET_DIR/.codex"
    echo "Installing to workspace: $TARGET_DIR"
else
    INSTALL_DIR="$GLOBAL_DIR"
    echo "Installing globally to $INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR/skills"
mkdir -p "$INSTALL_DIR/scripts"
mkdir -p "$INSTALL_DIR/config"
mkdir -p "$INSTALL_DIR/codex-vnsq"

cp "$SOURCE_DIR/AGENTS.md" "$INSTALL_DIR/AGENTS.md"
cp "$SOURCE_DIR/README.md" "$INSTALL_DIR/README.md"
cp "$SOURCE_DIR/TEST-PLAN.md" "$INSTALL_DIR/TEST-PLAN.md"
cp "$REPO/config/gemini-settings.json" "$INSTALL_DIR/config/gemini-settings.json"

rm -rf "$INSTALL_DIR/codex-vnsq/skills" "$INSTALL_DIR/codex-vnsq/scripts"
mkdir -p "$INSTALL_DIR/codex-vnsq/skills" "$INSTALL_DIR/codex-vnsq/scripts"
cp -R "$SOURCE_DIR/skills/." "$INSTALL_DIR/codex-vnsq/skills/"
cp "$SOURCE_DIR/scripts/"*-ask.js "$INSTALL_DIR/codex-vnsq/scripts/"
cp "$SOURCE_DIR/scripts/deploy-codex-vnsq.sh" "$INSTALL_DIR/codex-vnsq/scripts/"
cp "$SOURCE_DIR/scripts/uninstall-codex-vnsq.sh" "$INSTALL_DIR/codex-vnsq/scripts/"

for skill_path in "$SOURCE_DIR/skills"/*/; do
    skill_name=$(basename "$skill_path")
    rm -rf "$INSTALL_DIR/skills/$skill_name"
    cp -R "$skill_path" "$INSTALL_DIR/skills/"
done

cp "$SOURCE_DIR/scripts/"*-ask.js "$INSTALL_DIR/scripts/"

echo
echo "Codex-VN-Squad deploy complete."
echo "Installed into: $INSTALL_DIR"
