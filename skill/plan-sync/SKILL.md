---
name: plan-sync
description: >-
  Collaborate with a human reviewer on an implementation plan through the
  plan-sync app before writing code. Use whenever you are about to start a
  non-trivial task and want human sign-off, when the user says "post the plan",
  "write the plan", "send it for review", "wait for approval", "check the
  plan", "pick up the plan", or "did they approve?", or when resuming work that
  was handed off. The flow: write a plan, hand it off, poll for the human's
  edits/approval, run a preflight check, then implement while reporting
  progress. Requires the PLAN_API_URL and PLAN_WORKSPACE environment variables.
---

# plan-sync

plan-sync is a shared plan document for the current workspace that a human
reviews and edits on their phone. There is exactly **one living plan per
workspace**. You (the agent) write to it through a small HTTP API; the human
reads, edits, and approves it; then the mandatory plugin gates implementation.

plan-sync runs **locally**, bound to `0.0.0.0` so the human can open it from
their phone on the same network. The skill starts the server itself.

## Setup

The bundled `scripts/plan` helper reads these (env, or `config.env` written by
`install.sh`):

- `PLAN_API_URL` — base URL of the app (default `http://localhost:3000`)
- `PLAN_WORKSPACE` — the workspace name for this repo (e.g. `hostlet`)
- `PLAN_SYNC_DIR` — path to the plan-sync app directory (set by `install.sh`;
  needed so `plan up` can start the server)
- `PLAN_HOST` / `PLAN_PORT` — local bind settings (`0.0.0.0:3000` by default)
- `PLAN_API_TOKEN` — optional; only if the server has auth enabled
- `PLAN_UPLOAD_ROOT` — where phone uploads are written (installer default:
  `<workspace>/.plan-sync/uploads`)
- `PLAN_AGENT_NAME` — runner name recorded by the plugin (default `codex`)
- `PLAN_AGENT_CMD` — non-interactive implementation command (default `codex exec`)
- `PLAN_PREFLIGHT_CMD` — command the plugin runs before implementation
- `PLAN_VALIDATE_CMD` — command the plugin runs before marking done

Run `./scripts/plan help` for the full command list. (`python3` is required for
the write commands; `jq` is used for pretty output if present.)

## The loop

### 0. Start the server
Before posting a plan, make sure the local server is up:
```bash
./scripts/plan up        # starts plan-sync on 0.0.0.0:3000 in the background if not already running
./scripts/plan doctor    # verifies config, server health, workspace status, and phone URL
```
On first run this installs deps and builds (~1 min); after that it's instant. It
prints the phone URL (e.g. `http://192.168.x.x:3000`) — give that to the user so
they can review on their phone. (`plan down` stops it; `plan restart` cycles it.)

### 1. Write the plan and hand it off
Draft the plan in markdown, then:
```bash
./scripts/plan put plan.md --title "Short title" --sync-file plan.md
./scripts/plan status review
./scripts/plan msg "Posted a plan for <task>. Ready for your review."
```
Then tell the user: "Plan posted — review it at `$PLAN_API_URL` on your phone."
**Do not start implementing directly. Implementation must go through
`./scripts/plan plugin`.**

### 2. Wait for the human's response
Block in the active Codex TUI until the human responds:
```bash
./scripts/plan plugin listen --timeout 600 --interval 3
```
The command prints a JSON event:
- `human_message`: treat the new human note(s) as reviewer input. Rewrite the
  whole `syncFile`, run `./scripts/plan put "$syncFile" --sync-file "$syncFile"`
  (preserving any title/type/ref metadata you need), post a concise agent reply,
  and run `plugin listen` again.
- `approved`: continue to the preflight check.
- `changes_requested`: address the feedback, rewrite/sync the plan, set status
  back to `review`, post a short reply, and run `plugin listen` again.
- `stale_approval`, `sync_error`, or `timeout`: report the reason and stop.

If the plan has no sync file, `plugin listen` uses `plans/<workspace>.md`.
Never write absolute or repo-escaping workspace file paths; the plugin reports those as
`sync_error`.

`./scripts/plan plugin wait` remains available for approval-only automation, but
the active TUI review loop should use `plugin listen` so phone messages wake the
same Codex session.

### Phone file uploads
The phone UI can upload `.csv`, `.txt`, `.md`, `.json`, and `.log` files into the
workspace upload inbox. Uploaded files are saved under `$PLAN_UPLOAD_ROOT`, added
to the plan as `reference` workspace files, and accompanied by a human note so
`plugin listen` wakes the active agent. Treat those uploaded paths like any other
workspace file during review and preflight.

### 3. Run the plugin gate
Use the plugin preflight and runner. The plugin validates approval version,
branch/SHA metadata, workspace files, and `$PLAN_PREFLIGHT_CMD` before it
launches Codex:
```bash
./scripts/plan plugin preflight
./scripts/plan plugin run-codex
```
For unattended handoff after posting the plan, use:
```bash
./scripts/plan plugin daemon
```

The plugin posts check/progress/proof messages and marks status `done` only
after `$PLAN_VALIDATE_CMD` passes. If the plan changes or the human requests
changes during implementation, the plugin interrupts Codex and exits nonzero.

## Status lifecycle (only these transitions are legal)
```
draft             → review
review            → approved | changes_requested | draft
changes_requested → review | draft
approved          → implementing | changes_requested
implementing      → done | changes_requested
done              → implementing | review
```
A PATCH to an illegal status returns HTTP 400 — follow the graph above.

See `reference/api.md` for the raw HTTP endpoints if you ever need them directly.
