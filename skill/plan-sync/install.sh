#!/usr/bin/env bash
set -euo pipefail

# Install the plan-sync skill into a workspace's .claude/skills/ directory and
# wire it to the local plan-sync app so the agent can start the server itself.
#
# Usage: ./install.sh <target-workspace-dir> [--no-start]

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"   # <repo>/skill/plan-sync -> <repo>

TARGET=""
START=1
for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    *) TARGET="$arg" ;;
  esac
done

[ -n "$TARGET" ] || { echo "usage: $0 <target-workspace-dir> [--no-start]" >&2; exit 1; }
[ -d "$TARGET" ] || { echo "error: target dir does not exist: $TARGET" >&2; exit 1; }

DEST="$TARGET/.claude/skills/plan-sync"
mkdir -p "$TARGET/.claude/skills"
rm -rf "$DEST"
cp -R "$SCRIPT_DIR" "$DEST"
chmod +x "$DEST/scripts/plan" "$DEST/install.sh" 2>/dev/null || true

# Record where the app lives + its URL so `plan up` can start it. Uses
# ": ${VAR:=...}" so a real environment variable still overrides these.
cat > "$DEST/config.env" <<EOF
: "\${PLAN_SYNC_DIR:=${REPO_ROOT}}"
: "\${PLAN_API_URL:=http://localhost:${PLAN_PORT:-3000}}"
EOF

echo "Installed plan-sync skill -> $DEST"
echo "  app dir:  $REPO_ROOT"
echo "  api url:  http://localhost:${PLAN_PORT:-3000}"

if [ "$START" = "1" ]; then
  echo
  echo "Starting the local server (first run installs deps + builds, ~1 min)…"
  PLAN_SYNC_DIR="$REPO_ROOT" "$DEST/scripts/plan" up || {
    echo "(could not start automatically — run: $DEST/scripts/plan up)" >&2
  }
fi

cat <<EOF

Set the workspace name for agents in this directory, e.g.:
  export PLAN_WORKSPACE=$(basename "$TARGET")

Then:  $DEST/scripts/plan help
EOF
