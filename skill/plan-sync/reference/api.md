# plan-sync API reference

Base URL: `$PLAN_API_URL` — the app runs locally (default `http://localhost:3000`;
reach it from a phone at `http://<lan-ip>:3000`). One living plan per workspace;
`:ws` is the workspace name. Auth is open by default; if
`PLAN_API_TOKEN` is set on the server, send `Authorization: Bearer <token>` on
writes. All write bodies are JSON and carry `"author": "agent"` or `"human"`.

| Method · Path | Body | Response |
|---|---|---|
| `GET /api/health` | — | `{ "ok": true }` |
| `GET /api/doctor` | — | Safe runtime/workspace diagnostics |
| `GET /api/workspaces` | — | `{ "workspaces": [Summary, …] }` |
| `GET /api/w/:ws` | — | `{ "plan": Plan, "messages": [Message, …] }` (auto-creates an empty draft) |
| `PUT /api/w/:ws` | `{author,title?,bodyMd,documentType?,linkedFile?,sourceBranch?,sourceSha?,referencedFiles?}` | `{ "plan": Plan }` — bumps `version`, snapshots a revision |
| `GET /api/w/:ws/status` | — | `{ status, version, updatedAt }` |
| `PATCH /api/w/:ws/status` | `{author,status,note?}` | `{ "plan": Plan }` — transition-checked (400 if illegal) |
| `GET /api/w/:ws/messages` | `?since=<ISO>` | `{ "messages": [Message, …] }` |
| `POST /api/w/:ws/messages` | `{author,kind?,body}` | `{ "message": Message }` |
| `POST /api/w/:ws/proof` | `{author,commits?,changedFiles?,validations?,runIds?,notes?}` | Posts a `Final Proof` proof message without changing the approved plan version |
| `GET /api/w/:ws/plugin-runs` | `?limit=N` | `{ "runs": [PluginRun, …] }` |
| `POST /api/w/:ws/plugin-runs` | `{id?,agentName,state?,planVersion?,approvedVersion?,approvedBranch?,approvedSha?,approvedAt?}` | Creates/updates a plugin run record |
| `PATCH /api/w/:ws/plugin-runs` | `{id,state?,planVersion?,approvedVersion?,approvedBranch?,approvedSha?,approvedAt?,endedAt?,exitCode?,errorText?}` | Updates a plugin run record |
| `GET /api/w/:ws/export` | `?format=markdown\|json` | Exports the plan, messages, revisions, metadata, and stale warnings |
| `GET /api/w/:ws/revisions` | `?limit=N` | `{ "revisions": [Revision, …] }` (newest first) |
| `GET /api/w/:ws/poll` | — | `{ status, version, updatedAt, messageCount, lastMessageAt }` |

`status` ∈ `draft | review | changes_requested | approved | implementing | done`.
`documentType` ∈ `plan | summary | retrospective`.
`kind` ∈ `note | approve | request_changes | check | progress | proof`.

## Plugin listen events

`./scripts/plan plugin listen` does not add a new HTTP endpoint. It polls the
existing export/messages/status data and prints one JSON event for the active
Codex TUI:

- `human_message`: new human discussion note(s). Includes `messages`, `plan`,
  and `syncFile`; Codex rewrites `syncFile`, then syncs it with `plan put`.
- `approved`: current plan is approved and gate-valid.
- `changes_requested`: human requested changes.
- `stale_approval`: approval exists but version/branch/SHA validation failed.
- `sync_error`: the linked file is absolute or escapes the repo.
- `timeout`: no relevant event occurred before the timeout.

When `plan.linkedFile` is empty, `syncFile` defaults to `plans/<workspace>.md`.

Status transitions (PATCH to anything else → HTTP 400):
```
draft → review
review → approved | changes_requested | draft
changes_requested → review | draft
approved → implementing | changes_requested
implementing → done | changes_requested
done → implementing | review
```

## Worked examples (raw curl)

Write a plan and hand it off:
```bash
curl -sS -X PUT "$PLAN_API_URL/api/w/hostlet" -H 'Content-Type: application/json' \
  -d '{"author":"agent","title":"Add caching","bodyMd":"# Plan\n- step 1\n- step 2"}'
curl -sS -X PATCH "$PLAN_API_URL/api/w/hostlet/status" -H 'Content-Type: application/json' \
  -d '{"author":"agent","status":"review"}'
```

Poll until the human responds, then read the result:
```bash
curl -sS "$PLAN_API_URL/api/w/hostlet/poll"        # watch status + lastMessageAt
curl -sS "$PLAN_API_URL/api/w/hostlet"             # full plan + messages once it changes
```

Report a check, implement, finish:
```bash
curl -sS -X POST "$PLAN_API_URL/api/w/hostlet/messages" -H 'Content-Type: application/json' \
  -d '{"author":"agent","kind":"check","body":"Preflight OK."}'
curl -sS -X PATCH "$PLAN_API_URL/api/w/hostlet/status" -H 'Content-Type: application/json' \
  -d '{"author":"agent","status":"implementing"}'
curl -sS -X PATCH "$PLAN_API_URL/api/w/hostlet/status" -H 'Content-Type: application/json' \
  -d '{"author":"agent","status":"done"}'
```
