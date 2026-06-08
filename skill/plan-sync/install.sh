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
TARGET_ABS="$(cd -- "$TARGET" && pwd)"

DEST="$TARGET_ABS/.claude/skills/plan-sync"
mkdir -p "$TARGET_ABS/.claude/skills"
rm -rf "$DEST"
cp -R "$SCRIPT_DIR" "$DEST"
chmod +x "$DEST/scripts/plan" "$DEST/install.sh" 2>/dev/null || true

mkdir -p "$TARGET_ABS/scripts"
cat > "$TARGET_ABS/scripts/plan" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="\$(cd -- "\$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
[ -f "\${SCRIPT_DIR}/../.claude/skills/plan-sync/config.env" ] && . "\${SCRIPT_DIR}/../.claude/skills/plan-sync/config.env"
: "\${PLAN_SYNC_DIR:=${REPO_ROOT}}"
exec "\${PLAN_SYNC_DIR}/scripts/plan" "\$@"
EOF
chmod +x "$TARGET_ABS/scripts/plan"

mkdir -p "$TARGET_ABS/.plan-sync"
cat > "$TARGET_ABS/.plan-sync/config.env" <<EOF
PLAN_WORKSPACE=$(basename "$TARGET_ABS")
PLAN_SYNC_DIR=${REPO_ROOT}
PLAN_API_URL=http://localhost:${PLAN_PORT:-3000}
PLAN_HOST=0.0.0.0
PLAN_PORT=${PLAN_PORT:-3000}
PLAN_UPLOAD_ROOT=${TARGET_ABS}/.plan-sync/uploads
EOF

if git -C "$TARGET_ABS" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mkdir -p "$TARGET_ABS/.git/info"
  touch "$TARGET_ABS/.git/info/exclude"
  grep -qxF ".plan-sync/" "$TARGET_ABS/.git/info/exclude" || echo ".plan-sync/" >> "$TARGET_ABS/.git/info/exclude"
fi

# Record where the app lives + its URL so `plan up` can start it. Uses
# ": ${VAR:=...}" so a real environment variable still overrides these.
cat > "$DEST/config.env" <<EOF
: "\${PLAN_SYNC_DIR:=${REPO_ROOT}}"
: "\${PLAN_HOST:=0.0.0.0}"
: "\${PLAN_PORT:=${PLAN_PORT:-3000}}"
: "\${PLAN_API_URL:=http://localhost:${PLAN_PORT:-3000}}"
: "\${PLAN_UPLOAD_ROOT:=${TARGET_ABS}/.plan-sync/uploads}"
: "\${PLAN_AGENT_NAME:=codex}"
: "\${PLAN_AGENT_CMD:=codex exec}"
: "\${PLAN_PREFLIGHT_CMD:=pnpm typecheck && pnpm lint}"
: "\${PLAN_VALIDATE_CMD:=pnpm typecheck && pnpm lint && pnpm test}"
: "\${PLAN_PLUGIN_POLL_INTERVAL:=3}"
: "\${PLAN_PLUGIN_TIMEOUT:=600}"
: "\${PLAN_APPROVAL_STRICT:=1}"
EOF

echo "Installed plan-sync skill -> $DEST"
echo "Installed plan wrapper -> $TARGET_ABS/scripts/plan"
echo "  app dir:  $REPO_ROOT"
echo "  api url:  http://localhost:${PLAN_PORT:-3000}"
echo "  bind:     0.0.0.0:${PLAN_PORT:-3000}"
echo "  uploads:  $TARGET_ABS/.plan-sync/uploads"

if [ "$START" = "1" ]; then
  echo
  echo "Starting the local server (first run installs deps + builds, ~1 min)…"
  PLAN_SYNC_DIR="$REPO_ROOT" "$DEST/scripts/plan" up || {
    echo "(could not start automatically — run: $DEST/scripts/plan up)" >&2
  }
fi

cat <<EOF

Set the workspace name for agents in this directory, e.g.:
  export PLAN_WORKSPACE=$(basename "$TARGET_ABS")

Then:  $TARGET_ABS/scripts/plan help
EOF
