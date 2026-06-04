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
reads, edits, and approves it; then you implement.

plan-sync runs **locally**, bound to `0.0.0.0` so the human can open it from
their phone on the same network. The skill starts the server itself.

## Setup

The bundled `scripts/plan` helper reads these (env, or `config.env` written by
`install.sh`):

- `PLAN_API_URL` — base URL of the app (default `http://localhost:3000`)
- `PLAN_WORKSPACE` — the workspace name for this repo (e.g. `hostlet`)
- `PLAN_SYNC_DIR` — path to the plan-sync app directory (set by `install.sh`;
  needed so `plan up` can start the server)
- `PLAN_API_TOKEN` — optional; only if the server has auth enabled

Run `./scripts/plan help` for the full command list. (`python3` is required for
the write commands; `jq` is used for pretty output if present.)

## The loop

### 0. Start the server
Before posting a plan, make sure the local server is up:
```bash
./scripts/plan up        # starts plan-sync on 0.0.0.0:3000 in the background if not already running
```
On first run this installs deps and builds (~1 min); after that it's instant. It
prints the phone URL (e.g. `http://192.168.x.x:3000`) — give that to the user so
they can review on their phone. (`plan down` stops it; `plan restart` cycles it.)

### 1. Write the plan and hand it off
Draft the plan in markdown, then:
```bash
./scripts/plan put plan.md --title "Short title"    # or:  echo "..." | ./scripts/plan put -
./scripts/plan status review
./scripts/plan msg "Posted a plan for <task>. Ready for your review."
```
Then tell the user: "Plan posted — review it at `$PLAN_API_URL` on your phone."
**Stop and wait for the human. Do not start implementing yet.**

### 2. Pick up the human's response
When asked to check, or while polling:
```bash
./scripts/plan poll        # cheap: status + message counts
```
When `status` becomes `approved` or `changes_requested`, or a new human message
appears, read the details:
```bash
./scripts/plan show        # the (possibly human-edited) plan body
./scripts/plan messages    # the discussion thread
```
- If `changes_requested`: address the feedback, `plan put` the revised plan,
  `plan status review`, post a short message, and wait again.
- If `approved`: continue to the preflight check.

### 3. Run a preflight check (before implementing)
Validate the approved plan against the **current** codebase, then report:
- Every file path the plan references exists (`test -e`); list any missing.
- Symbols/functions the plan relies on still exist (`grep`).
- The project's gates pass — run lint / typecheck / tests
  (`pnpm lint && pnpm typecheck && pnpm test`, or the project's equivalent).

Post the result:
```bash
./scripts/plan msg --kind check "Preflight: 12/12 referenced files exist, typecheck clean, tests green."
```
If the check fails in a way that invalidates the plan, hand back instead of
implementing:
```bash
./scripts/plan status changes_requested --note "Preflight failed: <why>."
```

### 4. Implement
```bash
./scripts/plan status implementing
# …do the work, posting progress as you go…
./scripts/plan msg --kind progress "Implemented step 1/3."
# …when finished and the gates pass again…
./scripts/plan status done
./scripts/plan msg --kind progress "Done. <summary of what changed>."
```

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
