#!/bin/bash
# deploy-codex-vnsq.sh — Install Codex-VN-Squad skills globally or into a target project
#
# Usage:
#   bash codex-vnsq/scripts/deploy-codex-vnsq.sh              # global install to ~/.codex/
#   bash codex-vnsq/scripts/deploy-codex-vnsq.sh <project>    # also deploy to <project>

set -e

REPO="$(git rev-parse --show-toplevel)"
GLOBAL_DIR="${CODEX_HOME:-$HOME/.codex}"
SOURCE_DIR="$REPO/codex-vnsq"

echo "Codex-VN-Squad — Deploy"
echo "Source: $SOURCE_DIR"
echo ""

chmod +x "$REPO/codex-vnsq/scripts/"*-ask.js "$REPO/codex-vnsq/scripts/vn-dispatch.js" "$REPO/codex-vnsq/scripts/deploy-codex-vnsq.sh" "$REPO/codex-vnsq/scripts/uninstall-codex-vnsq.sh"

SCOPE="global"
if [ -n "$1" ]; then
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

mkdir -p "$INSTALL_DIR/scripts"
mkdir -p "$INSTALL_DIR/skills"
mkdir -p "$INSTALL_DIR/config"
mkdir -p "$INSTALL_DIR/codex-vnsq/scripts"
mkdir -p "$INSTALL_DIR/codex-vnsq/skills"

cp "$SOURCE_DIR/AGENTS.md" "$INSTALL_DIR/AGENTS.md"
cp "$SOURCE_DIR/README.md" "$INSTALL_DIR/README.md"
cp "$SOURCE_DIR/TEST-PLAN.md" "$INSTALL_DIR/TEST-PLAN.md"
cp "$REPO/config/gemini-settings.json" "$INSTALL_DIR/config/gemini-settings.json"

for script_name in codex-ask claude-ask gemini-ask vn-dispatch; do
  src="$SOURCE_DIR/scripts/$script_name.js"
  [ -f "$src" ] || continue
  cp "$src" "$INSTALL_DIR/scripts/$script_name.js"
  cp "$src" "$INSTALL_DIR/codex-vnsq/scripts/$script_name.js"
done

for script_name in deploy-codex-vnsq uninstall-codex-vnsq; do
  src="$SOURCE_DIR/scripts/$script_name.sh"
  [ -f "$src" ] || continue
  cp "$src" "$INSTALL_DIR/scripts/$script_name.sh"
  cp "$src" "$INSTALL_DIR/codex-vnsq/scripts/$script_name.sh"
done

rm -rf "$INSTALL_DIR/skills"/*
cp -R "$SOURCE_DIR/skills/." "$INSTALL_DIR/skills/"
rm -rf "$INSTALL_DIR/codex-vnsq/skills"
cp -R "$SOURCE_DIR/skills" "$INSTALL_DIR/codex-vnsq/"

echo ""
echo "Codex-VN-Squad deploy complete."
echo "Installed into: $INSTALL_DIR"
