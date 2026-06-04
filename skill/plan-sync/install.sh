#!/usr/bin/env bash
set -euo pipefail

# Install the plan-sync skill into a workspace's .claude/skills/ directory.
# Usage: ./install.sh <target-workspace-dir>

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"

[ -n "$TARGET" ] || { echo "usage: $0 <target-workspace-dir>" >&2; exit 1; }
[ -d "$TARGET" ] || { echo "error: target dir does not exist: $TARGET" >&2; exit 1; }

DEST="$TARGET/.claude/skills/plan-sync"
mkdir -p "$TARGET/.claude/skills"
rm -rf "$DEST"
cp -R "$SCRIPT_DIR" "$DEST"
chmod +x "$DEST/scripts/plan" "$DEST/install.sh" 2>/dev/null || true

echo "Installed plan-sync skill -> $DEST"
cat <<EOF

Next: point it at your plan-sync app and this workspace, e.g.

  export PLAN_API_URL=https://plan.example.com
  export PLAN_WORKSPACE=$(basename "$TARGET")

Then run:  $DEST/scripts/plan help
EOF
