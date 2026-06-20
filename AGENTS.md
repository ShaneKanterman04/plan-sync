<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## plan-sync specifics

- **Dynamic route params are async.** Every `app/api/w/[workspace]/**` handler receives `{ params }: { params: Promise<{ workspace: string }> }` and must `await params`.
- **better-sqlite3 needs the Node runtime.** Data routes set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`. It is a native module, so the Docker build installs `python3 make g++`, and pnpm only builds it because it is allow-listed in `pnpm-workspace.yaml` (`onlyBuiltDependencies`).
- **Auth is open in the MVP.** Write routes trust an `author` field (`'agent' | 'human'`). Setting `PLAN_API_TOKEN` turns on Bearer auth via `requireAuth()` without touching route code.
- **One primary plan plus multiple documents per workspace.** The `plans` table is unchanged (PK = workspace; holds the primary plan with its `revisions` history and `messages` thread). Additional agent-published documents live in the new additive `documents` table (PK = workspace + `doc_id`, where `doc_id` equals the slug), each with its own `document_messages` discussion thread. Document type is one of `plan | summary | retrospective`. Re-publishing the same slug updates the existing document in place; the `plans` table was not migrated — the data layer is purely additive.
- **Dogfood it.** Proactively keep the human in the loop on their phone — via the `plan-sync` skill, or `./scripts/plan` from the skill dir: post a primary `plan` (`plan put` + `plan status review`) before non-trivial work; publish a `summary` document (`plan new <slug> --type summary --file <f>`) when you finish a substantial change; publish a `retrospective` after an incident. One new document per topic — never overwrite the primary plan with a status/summary.
