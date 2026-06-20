---
name: plan-sync
description: >-
  Collaborate with a human reviewer on an implementation plan through the
  plan-sync app before writing code, or publish status/summary/retrospective
  documents the human can browse on their phone. Use whenever you are about to
  start a non-trivial task and want human sign-off, when the user says "post
  the plan", "write the plan", "send it for review", "wait for approval",
  "check the plan", "pick up the plan", or "did they approve?", or when
  resuming work that was handed off. Also use when you finish a substantial
  piece of work and want to share the outcome ("publish a summary", "post an
  update", "share a doc to my phone", "publish a retrospective"). The flow:
  write a plan, hand it off, poll for the human's edits/approval, then
  implement while reporting progress. Requires the PLAN_API_URL and
  PLAN_WORKSPACE environment variables.
---

# plan-sync

plan-sync is a shared workspace where a human reviews documents on their phone.
Each workspace holds **one primary plan** (the review→approve→implement
lifecycle) **plus any number of additional documents** — summaries, status
updates, retrospectives — that the agent publishes and the human can browse and
discuss. You write everything through a small HTTP API; the human reads, edits,
and approves via the phone UI. Publishing an extra document never overwrites
the primary plan.

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
- `PLAN_PREFLIGHT_CMD` / `PLAN_VALIDATE_CMD` — the project's preflight and
  validation commands; run them yourself before you implement and before you
  mark the plan `done` (there is no plugin runner in this install — you drive
  the work and report progress manually)

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
**Do not start implementing directly — wait for approval via `./scripts/plan watch`.**

### 2. Wait for the human's response
Block until the human responds:
```bash
./scripts/plan watch --timeout 600 --interval 3
```
The command blocks, then exits and prints what changed. Interpret the outcome:
- **Human message posted**: treat the new note(s) as reviewer input. Rewrite the
  plan file, run `./scripts/plan put <file>` to sync it, post a concise agent
  reply with `./scripts/plan msg`, and run `watch` again.
- **Status → `approved`**: continue to implementation (step 3).
- **Status → `changes_requested`**: address the feedback, update the plan file,
  run `./scripts/plan put <file>`, set status back to `review`, post a short
  reply, and run `watch` again.
- **Timeout**: report the reason and stop; the human can resume later.

### Phone file uploads
The phone UI can upload `.csv`, `.txt`, `.md`, `.json`, and `.log` files into the
workspace upload inbox. Uploaded files are saved under `$PLAN_UPLOAD_ROOT`, added
to the plan as `reference` workspace files, and accompanied by a human note so
`./scripts/plan watch` wakes the active agent. Treat those uploaded paths like
any other workspace file during review and preflight.

### 3. Implement and report progress
After approval, implement the plan. Post progress and proof messages as you go:
```bash
./scripts/plan status implementing
./scripts/plan msg "Starting implementation — <brief description>."
# … do the work …
./scripts/plan msg "Done — <what was verified>."
./scripts/plan status done
```
If the human requests changes mid-implementation, run `./scripts/plan watch` at
key milestones to catch new messages, address them, set status back to `review`,
and run `watch` again before continuing.

## Documents (publish more than the plan)

In addition to the primary plan, you can publish standalone documents —
summaries, status updates, retrospectives — that the human can browse and
discuss on their phone. Document type is one of `plan | summary | retrospective`.
Each document is addressed by a slug; re-publishing the same slug updates it in place.

```bash
./scripts/plan docs                                          # list all documents in the workspace
./scripts/plan new <slug> --title "T" [--type summary|retrospective|plan] [--file F]
                                                             # publish a NEW document
./scripts/plan put <file> --doc <slug> [--title "T"]        # update an existing document
./scripts/plan msg "text" --doc <slug>                      # comment on a document's thread
# Without --doc, put/msg target the PRIMARY plan (unchanged behaviour)
```

**ACTIVELY USE IT — mandatory, not optional. Publish these proactively, without waiting to be asked:**

- **Before non-trivial work**: post a primary `plan` and go through the approve flow above.
- **When you finish a substantial piece of work**: publish a `summary` document
  (`./scripts/plan new <topic> --type summary`) covering what changed, how it was
  validated, and what's next. One new slug per deliverable/topic.
- **After an incident or for lessons learned**: publish a `retrospective` document.
- **For long-running efforts**: keep a status document and update it in place
  (`./scripts/plan put <file> --doc <slug>`).

Never overwrite the primary plan with a status/summary report — extra documents
are exactly what the slug-addressed commands are for.

`./scripts/plan watch` tracks only the **primary plan**. A published document's
discussion thread is separate — to read the human's replies on a document you
published, re-run `./scripts/plan docs` (its per-document message count rises) or
`GET /api/w/:ws/d/:doc/messages?since=<ISO>`. Documents are publish-and-discuss;
the approval/`watch` gate is for the primary plan only.

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
