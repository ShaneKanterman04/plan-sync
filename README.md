# plan-sync

A tiny, mobile-first web app that holds a **primary plan document plus any number
of additional agent-published documents** that AI coding agents and a human
collaborate on. Each workspace has one primary plan (the review → approve →
implement lifecycle) and agents can publish extra `summary` or `retrospective`
documents at any time — all browsable in the multi-document switcher UI on your
phone.

**The loop:** an agent writes a proposed plan → you read/edit/approve it on your
phone → the agent picks up your changes, runs a check, and implements. Agents also
publish summary and retrospective documents so you can review progress and lessons
learned without leaving the phone UI.

- **Mobile UI** for humans: rendered markdown, inline edit, approve / request
  changes, upload CSV/text files from a phone, a discussion thread per document,
  and a multi-document switcher to browse all agent-published docs.
- **Multiple documents per workspace**: one primary plan plus any number of
  agent-published documents (`summary`, `retrospective`, or `plan`), each
  addressed by slug.
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

A workspace holds a **primary plan** plus any number of additional **documents**
(see the next paragraph). The primary plan is one row per workspace in `plans`,
plus a `plan_files`
attachment set, a `revisions` snapshot per body change, and a `messages` thread.
Each workspace can have one sync file and many reference files; legacy
`linkedFile` and `referencedFiles` fields are still derived for older clients.
The plan row also stores document type (`plan`, `summary`, or `retrospective`),
source branch/SHA, and approval metadata for stale-plan warnings. Status
lifecycle:

Additional agent-published documents are stored in two additive tables:
`documents` (one row per slug; `doc_id == slug`; columns: workspace, slug, title,
body_md, document_type, author, archived, created_at, updated_at) and
`document_messages` (the per-document discussion thread). The `plans` table and
its related tables are unchanged — `documents` is purely additive.

```
draft             → review
review            → approved | changes_requested | draft
changes_requested → review | draft
approved          → implementing | changes_requested
implementing      → done | changes_requested
done              → implementing | review
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

The agent uses `scripts/plan` for the primary plan (`put`, `status`, `msg`,
`watch`, …) and for additional documents (`docs` to list, `new <slug>` to
publish, `put --doc <slug>` / `msg --doc <slug>` to update or comment). During
review the agent blocks with `plan watch`, which polls the **primary plan** until
the human approves, requests changes, or replies, then prints what changed.
(`watch` tracks only the primary plan; replies on a published document are read
via the `plan docs` message count or `GET /api/w/:ws/d/:doc/messages?since=`.)
After approval the agent implements and reports progress, running the project's
preflight/validate commands itself (there is no plugin runner in this install).
Useful additions:

```bash
./scripts/plan put plan.md --title "Core UI cleanup" --type plan --sync-file docs/plan.md --ref apps/web/page.tsx
./scripts/plan status review
./scripts/plan watch --interval 5 --timeout 600   # block until human approves / edits / replies (primary plan)
./scripts/plan docs                               # list the workspace's documents
./scripts/plan new release-notes --title "Release notes" --type summary --file notes.md   # publish a document
./scripts/plan proof --commit d0d853d --validation "pnpm test passed" --run-id 26964872228
./scripts/plan export --format markdown --out /tmp/plan-sync-export.md
```

When `watch` unblocks with a `human_message` event, Codex treats the message as
reviewer input, rewrites the whole local plan file, runs `plan put` on that file,
posts a reply, and calls `watch` again. If a plan has no sync file, the local file
defaults to `plans/<workspace>.md`; absolute paths or paths escaping the repo are
rejected.

Open a review-only phone view by adding `?readonly=1` to a workspace URL.

The data (your plans) lives in `$DATA_DIR` (default `./.data`) and persists
across restarts. Phone uploads are written to `$PLAN_UPLOAD_ROOT`, which the
installer defaults to `<target-workspace>/.plan-sync/uploads`; uploaded files are
attached to the plan as reference workspace files.

Upload endpoint:

```bash
curl -s -X POST localhost:3000/api/w/hostlet/uploads \
  -F 'files=@risk-register.csv'
```

Uploads accept `.csv`, `.txt`, `.md`, `.json`, and `.log` files, up to 10 MB per
file and 10 files per request. The endpoint bumps the plan version, adds the new
paths to `Plan.files`, and posts a human note so a blocking `plan watch` call
wakes the agent.
