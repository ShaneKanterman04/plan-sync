# plan-sync API reference

Base URL: `$PLAN_API_URL` — the app runs locally (default `http://localhost:3000`;
reach it from a phone at `http://<lan-ip>:3000`). One living plan per workspace;
`:ws` is the workspace name. Auth is open by default; if
`PLAN_API_TOKEN` is set on the server, send `Authorization: Bearer <token>` on
writes. All write bodies are JSON and carry `"author": "agent"` or `"human"`.

| Method · Path | Body | Response |
|---|---|---|
| `GET /api/health` | — | `{ "ok": true }` |
| `GET /api/workspaces` | — | `{ "workspaces": [Summary, …] }` |
| `GET /api/w/:ws` | — | `{ "plan": Plan, "messages": [Message, …] }` (auto-creates an empty draft) |
| `PUT /api/w/:ws` | `{author,title?,bodyMd}` | `{ "plan": Plan }` — bumps `version`, snapshots a revision |
| `GET /api/w/:ws/status` | — | `{ status, version, updatedAt }` |
| `PATCH /api/w/:ws/status` | `{author,status,note?}` | `{ "plan": Plan }` — transition-checked (400 if illegal) |
| `GET /api/w/:ws/messages` | `?since=<ISO>` | `{ "messages": [Message, …] }` |
| `POST /api/w/:ws/messages` | `{author,kind?,body}` | `{ "message": Message }` |
| `GET /api/w/:ws/revisions` | `?limit=N` | `{ "revisions": [Revision, …] }` (newest first) |
| `GET /api/w/:ws/poll` | — | `{ status, version, updatedAt, messageCount, lastMessageAt }` |

`status` ∈ `draft | review | changes_requested | approved | implementing | done`.
`kind` ∈ `note | approve | request_changes | check | progress`.

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
