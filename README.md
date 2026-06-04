# plan-sync

A tiny, mobile-first web app that holds a **shared plan document** that AI coding
agents and a human collaborate on — one living plan per dev workspace.

**The loop:** an agent writes a proposed plan → you read/edit/approve it on your
phone → the agent picks up your changes, runs a check, and implements.

- **Mobile UI** for humans: rendered markdown, inline edit, approve / request
  changes, and a discussion thread.
- **Simple JSON API** for agents.
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
snapshot per body change and a `messages` thread. Status lifecycle:

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

## The agent skill

The skill lives in this repo at `skill/plan-sync/`. Install it into any
workspace:

```bash
skill/plan-sync/install.sh /path/to/your/workspace
# then, in that workspace:
export PLAN_API_URL=https://<your-hostlet-app-url>
export PLAN_WORKSPACE=hostlet
```

The agent then uses `scripts/plan` (`put`, `status`, `msg`, `poll`, `show`, …)
to write plans, wait for your review, run a preflight check, and implement.

## Deploy via self-hosted hostlet

plan-sync ships hostlet-ready: `hostlet.yml` (compose runtime), a compliant
`compose.yaml` (named volume only — no host ports/bind mounts), and a
`Dockerfile`. hostlet builds the repo, gives it a public tunnel URL, reuses the
`plansync-data` volume across redeploys (**data is preserved**), and can
auto-deploy on push.

**1. Update the self-hosted hostlet first** (on the VM):

```bash
hostlet backup            # safety snapshot
hostlet update check      # see if a new release is available
hostlet update            # apply it
hostlet status && hostlet doctor
```

**2. Add plan-sync as an app in the hostlet UI:** connect this GitHub repo, pick
the branch, enable auto-deploy. hostlet reads `hostlet.yml` (port 3000, health
`/api/health`), builds, and assigns a public URL.

**3. Point agents at it:** set `PLAN_API_URL` to the app's public URL in each
workspace that installs the skill.
