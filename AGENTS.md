<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## plan-sync specifics

- **Dynamic route params are async.** Every `app/api/w/[workspace]/**` handler receives `{ params }: { params: Promise<{ workspace: string }> }` and must `await params`.
- **better-sqlite3 needs the Node runtime.** Data routes set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`. It is a native module, so the Docker build installs `python3 make g++`, and pnpm only builds it because it is allow-listed in `pnpm-workspace.yaml` (`onlyBuiltDependencies`).
- **Auth is open in the MVP.** Write routes trust an `author` field (`'agent' | 'human'`). Setting `PLAN_API_TOKEN` turns on Bearer auth via `requireAuth()` without touching route code.
- **One plan document per workspace.** The `workspace` name is the primary key; there is exactly one living plan per workspace plus a `revisions` history and a `messages` thread.
