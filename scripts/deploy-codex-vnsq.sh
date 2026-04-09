#!/bin/bash

set -euo pipefail

REPO="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
SOURCE_DIR="$REPO/codex-vnsq"
GLOBAL_DIR="${CODEX_HOME:-$HOME/.codex}"
SKILLS=(plan dispatch worktrees verify review finish argue scaffold)

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: missing codex-vnsq package at $SOURCE_DIR"
  exit 1
fi

TARGET="${1:-$GLOBAL_DIR}"

echo "Codex-VNSQ deploy"
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET"
echo

mkdir -p "$TARGET"
mkdir -p "$TARGET/scripts"
mkdir -p "$TARGET/skills"
mkdir -p "$TARGET/codex-vnsq"

cp "$SOURCE_DIR/AGENTS.md" "$TARGET/AGENTS.md"
cp "$SOURCE_DIR/README.md" "$TARGET/README.md"
cp "$REPO/scripts/codex-ask.js" "$TARGET/scripts/codex-ask.js"

rm -rf "$TARGET/codex-vnsq/skills"
cp -R "$SOURCE_DIR/skills" "$TARGET/codex-vnsq/"

for skill_name in "${SKILLS[@]}"; do
  skill_dir="$SOURCE_DIR/skills/$skill_name"
  [ -d "$skill_dir" ] || continue
  rm -rf "$TARGET/skills/$skill_name"
  cp -R "$skill_dir" "$TARGET/skills/"
done

cat <<EOF
Installed:
  - $TARGET/AGENTS.md
  - $TARGET/README.md
  - $TARGET/scripts/codex-ask.js
  - $TARGET/codex-vnsq/skills/*
  - $TARGET/skills/*

Verify:
  node "$TARGET/scripts/codex-ask.js" "what is 2+2"
  ls "$TARGET/codex-vnsq/skills"
  ls "$TARGET/skills"
EOF
