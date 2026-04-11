#!/bin/bash

set -euo pipefail

REPO="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
exec bash "$REPO/codex-vnsq/scripts/deploy-codex-vnsq.sh" "$@"
