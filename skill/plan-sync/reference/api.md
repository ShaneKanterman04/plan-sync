# plan-sync API reference

Base URL: `$PLAN_API_URL` — the app runs locally (default `http://localhost:3000`;
reach it from a phone at `http://<lan-ip>:3000`). A workspace holds ONE primary
plan (review → approve → implement lifecycle) PLUS any number of additional
agent-published documents (summaries, retrospectives, status reports). `:ws` is
the workspace name. Auth is open by default; if
`PLAN_API_TOKEN` is set on the server, send `Authorization: Bearer <token>` on
writes. All write bodies are JSON and carry `"author": "agent"` or `"human"`.

| Method · Path | Body | Response |
|---|---|---|
| `GET /api/health` | — | `{ "ok": true }` |
| `GET /api/doctor` | — | Safe runtime/workspace diagnostics |
| `GET /api/workspaces` | — | `{ "workspaces": [Summary, …] }` |
| `GET /api/w/:ws` | — | `{ "plan": Plan, "messages": [Message, …], "documents": [DocumentSummary, …] }` (auto-creates an empty draft) |
| `PUT /api/w/:ws` | `{author,title?,bodyMd,documentType?,files?,linkedFile?,sourceBranch?,sourceSha?,referencedFiles?}` | `{ "plan": Plan }` — bumps `version`, snapshots a revision |
| `POST /api/w/:ws/uploads` | `multipart/form-data` with `files` | `{ "plan": Plan, "uploaded": [{originalName,path,size}, …] }` — writes files to `$PLAN_UPLOAD_ROOT`, appends them as reference files, bumps `version`, and posts a human upload note |
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
| `GET /api/w/:ws/documents` | — | `{ "documents": [DocumentSummary, …] }` — list all non-archived documents in the workspace |
| `POST /api/w/:ws/documents` | `{author,slug,title,bodyMd,documentType?}` | `{ "document": Document }` — publish a new document; re-posting the same slug updates it in place. `documentType` ∈ `plan \| summary \| retrospective` (default `summary`) |
| `GET /api/w/:ws/d/:doc` | — | `{ "document": Document }` — fetch a document by slug |
| `PUT /api/w/:ws/d/:doc` | `{author,title?,bodyMd}` | `{ "document": Document }` — replace document body/title |
| `PATCH /api/w/:ws/d/:doc` | `{author,archived}` | `{ "document": Document }` — archive (or unarchive) a document |
| `DELETE /api/w/:ws/d/:doc` | — | `{}` — permanently delete a document |
| `GET /api/w/:ws/d/:doc/messages` | `?since=<ISO>` | `{ "messages": [Message, …] }` — discussion thread for this document |
| `POST /api/w/:ws/d/:doc/messages` | `{author,kind?,body}` | `{ "message": Message }` — post to this document's discussion thread |

`status` ∈ `draft | review | changes_requested | approved | implementing | done`.
`documentType` ∈ `plan | summary | retrospective`.
`files[]` entries are `{path, role}` where `role` ∈ `sync | reference`; old
`linkedFile` and `referencedFiles` fields remain compatible.
Uploads accept `.csv`, `.txt`, `.md`, `.json`, and `.log` files, up to 10 MB per
file and 10 files per request. Uploaded paths are relative to the target
workspace, normally `.plan-sync/uploads/<workspace>/<generated-name>`.
`kind` ∈ `note | approve | request_changes | check | progress | proof`.
The `/plugin-runs` endpoints are a legacy run-record surface; the `plan-sync`
skill flow does **not** use a plugin runner (you implement and report progress
yourself — see the `watch` note below).

## Watching for a human response

The implemented blocking-wait command is:

```bash
./scripts/plan watch [--interval N] [--timeout S]
```

It polls `GET /api/w/:ws/poll` (and `/messages`, `/status`) and **blocks until
the human approves, requests changes, edits the plan, or replies**; then it
prints a summary of what changed and exits.

**Scope:** `watch` (and `/poll`, `/messages`) track only the **primary plan**.
A published document's discussion thread is separate — to see human replies on a
document you published, poll `GET /api/w/:ws/d/:doc/messages?since=<ISO>` (or
`./scripts/plan docs`, whose per-document message count rises). Documents are
publish-and-discuss; the approve/`watch` gate is for the primary plan only.

> Note: the `plan-sync` skill's bundled `./scripts/plan` does **not** include the
> `plugin` sub-commands (`listen` / `wait` / `preflight` / `run-codex` /
> `daemon`) — `./scripts/plan watch` is the blocking-wait. Do not tell agents to
> run `plan plugin ...`.

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

Publish a summary document after completing work (slug identifies the document;
re-posting the same slug updates in place):
```bash
curl -sS -X POST "$PLAN_API_URL/api/w/hostlet/documents" \
  -H 'Content-Type: application/json' \
  -d '{
    "author": "agent",
    "slug": "caching-summary",
    "title": "Caching implementation — summary",
    "documentType": "summary",
    "bodyMd": "## What changed\n- Added Redis layer\n\n## Validated\n- Tests green\n\n## Next\n- Monitor hit rate"
  }'
# Update it later:
curl -sS -X PUT "$PLAN_API_URL/api/w/hostlet/d/caching-summary" \
  -H 'Content-Type: application/json' \
  -d '{"author":"agent","bodyMd":"## Updated body …"}'
# List all documents in the workspace:
curl -sS "$PLAN_API_URL/api/w/hostlet/documents"
```

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
