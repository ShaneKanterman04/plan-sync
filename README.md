# plan-sync

A tiny, mobile-first web app that holds a **shared plan document** that AI coding
agents and a human collaborate on — one living plan per dev workspace.

**The loop:** an agent writes a proposed plan → you read/edit/approve it on your
phone → the agent picks up your changes, runs a check, and implements.

- **Mobile UI** for humans: rendered markdown, inline edit, approve / request
  changes, and a discussion thread.
- **Simple JSON API** for agents, including export and final-proof helpers.
- **Diagnostics** for local server/workspace state so agents can tell whether
  the app, workspace, or phone view is stuck.
- **A downloadable skill** (`skill/plan-sync/`) any agent can drop into a
  workspace's `.claude/skills/` to drive the API.

Stack: Next.js 16 + React 19 + TypeScript + Tailwind 4 + better-sqlite3 + Zod.
One service serves the UI and the API on port 3000.

## Run locally

```bash
pnpm install
pnpm dev            # http://localhost:3000
# optional sample data:
pnpm seed
```

Quality gates: `pnpm typecheck && pnpm lint && pnpm test`.

### Exercise the API

```bash
curl -s localhost:3000/api/health        # {"ok":true}
curl -s localhost:3000/api/doctor        # safe runtime/workspace diagnostics

# agent writes a plan and hands it off
curl -s -X PUT localhost:3000/api/w/hostlet -H 'Content-Type: application/json' \
  -d '{"author":"agent","title":"Add caching","bodyMd":"# Plan\n- step 1"}'
curl -s -X PATCH localhost:3000/api/w/hostlet/status -H 'Content-Type: application/json' \
  -d '{"author":"agent","status":"review"}'

# human approves (the UI normally does this)
curl -s -X PATCH localhost:3000/api/w/hostlet/status -H 'Content-Type: application/json' \
  -d '{"author":"human","status":"approved"}'

# agent picks up
curl -s localhost:3000/api/w/hostlet/poll
```

See `skill/plan-sync/reference/api.md` for the full API.

## Data model

One row per workspace in `plans` (the living document), plus a `revisions`
snapshot per body change and a `messages` thread. The plan row also stores
document type (`plan`, `summary`, or `retrospective`), an optional linked file,
referenced files, source branch/SHA, and approval metadata for stale-plan
warnings. Status lifecycle:

```
draft → review → {approved | changes_requested} → implementing → done
```

Illegal transitions return HTTP 400. The SQLite file lives at `$DATA_DIR`
(default `./.data`, the mounted volume in production).

## Auth

Open by default — write requests carry an `author` field (`agent` | `human`).
To lock it down, set `PLAN_API_TOKEN`; every write route then requires
`Authorization: Bearer <token>` with no code changes. The skill's `scripts/plan`
forwards `PLAN_API_TOKEN` when set.

## How it runs

plan-sync runs **locally**, bound to `0.0.0.0` so you can open it from your phone
on the same Wi-Fi (`http://<lan-ip>:3000`). There's no hosting/tunnel to set up —
the agent skill starts the server itself.

## The agent skill

The skill lives in this repo at `skill/plan-sync/`. Install it into any
workspace (this also records where the app lives and starts the server):

```bash
skill/plan-sync/install.sh /path/to/your/workspace      # add --no-start to skip auto-start
# then, in that workspace:
export PLAN_WORKSPACE=<workspace-name>
```

`install.sh` writes a `config.env` with `PLAN_SYNC_DIR` (this repo) and
`PLAN_API_URL` (`http://localhost:3000`), so the agent can manage the server:

```bash
./scripts/plan up        # start plan-sync on 0.0.0.0:3000 (background); prints the phone URL
./scripts/plan serve --host 0.0.0.0 --port 3000 --workspace hostlet
./scripts/plan down      # stop it
./scripts/plan doctor    # config, health, phone URL, workspace status
```

The agent then uses `scripts/plan` (`put`, `status`, `msg`, `poll`, `show`, …) to
write plans. During review, the active Codex TUI blocks in `plugin listen`: a
human discussion message wakes the same Codex session, which rewrites the
linked plan file and syncs the full plan body back to plan-sync. Implementation
is still gated by the mandatory plugin commands; Codex is launched only after
approval metadata and preflight checks pass.
Useful additions:

```bash
./scripts/plan put plan.md --title "Core UI cleanup" --type plan --linked-file docs/plan.md --ref apps/web/page.tsx
./scripts/plan status review
./scripts/plan plugin listen --timeout 600 --interval 3
./scripts/plan plugin wait --timeout 600 --interval 3
./scripts/plan plugin preflight
./scripts/plan plugin run-codex
./scripts/plan proof --commit d0d853d --validation "pnpm test passed" --run-id 26964872228
./scripts/plan export --format markdown --out /tmp/plan-sync-export.md
```

When `plugin listen` returns a `human_message` event, Codex treats the message as
reviewer input, rewrites the whole local plan file, runs `plan put` on that file,
posts a reply, and listens again. If a plan has no `linkedFile`, the local file
defaults to `plans/<workspace>.md`; absolute paths or paths escaping the repo are
rejected.

For unattended handoff, run:

```bash
./scripts/plan plugin daemon
```

The daemon polls for approval, validates version/branch/SHA metadata, exports
the approved plan, runs `$PLAN_PREFLIGHT_CMD`, launches `${PLAN_AGENT_CMD:-codex
exec}` non-interactively, watches for human interruption, runs
`$PLAN_VALIDATE_CMD`, posts proof, and marks the plan `done` only after
validation passes.

Open a review-only phone view by adding `?readonly=1` to a workspace URL.

The data (your plans) lives in `$DATA_DIR` (default `./.data`) and persists
across restarts.
