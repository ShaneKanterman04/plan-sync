# Workspace Multi-File Stability Plan

## Summary

- Keep the core invariant: one living plan per workspace.
- Add a first-class workspace file attachment set: one optional sync file plus many reference files.
- Preserve existing `linkedFile` and `referencedFiles` clients while moving the app, API, CLI, export, and preflight logic to the new file model.
- Harden stability around path validation, transactional writes, SSE reconnect behavior, and expected vs unexpected API errors.

## Public Interfaces

- Add `WorkspaceFileRole = "sync" | "reference"` and `WorkspaceFile = { path: string; role: WorkspaceFileRole }`.
- Add `Plan.files: WorkspaceFile[]`; keep these derived compatibility fields:
  - `Plan.linkedFile` = sync file path or `""`.
  - `Plan.referencedFiles` = reference file paths.
- Add `WorkspaceSummary.fileCount`, `WorkspaceSummary.primaryFile`, and `WorkspaceSummary.files`; keep `linkedFile`.
- Extend `PUT /api/w/:workspace` with `files?: WorkspaceFile[]`.
  - If `files` is present, it replaces the workspace file set.
  - If `files` is absent, existing `linkedFile` and `referencedFiles` behavior is preserved.
  - Reject absolute paths, repo-escaping paths, empty paths, more than 200 files, duplicate explicit file entries, and more than one `sync` file.
- Update the CLI:
  - Add `--sync-file PATH`.
  - Keep `--linked-file PATH` as an alias.
  - Keep repeatable `--ref PATH`.
  - Emit the new `files` payload while remaining compatible with older API fields.

## Implementation Changes

- Add a normalized `plan_files` SQLite table keyed by workspace and path, with role and timestamps.
- Backfill `plan_files` idempotently from existing `plans.linked_file` and `plans.referenced_files`; keep legacy columns populated from `files` for compatibility.
- Update plan row mapping, workspace summaries, exports, revisions-related metadata, and `putPlanBody` so plan body changes and file-set changes commit in one transaction.
- Add shared file-path normalization used by API validation, DB writes, plugin sync resolution, and preflight.
- Update plugin behavior:
  - `syncFileForPlan()` uses `plan.files` sync file first, legacy `linkedFile` second, then `plans/<workspace>.md`.
  - Preflight checks all explicit workspace files relative to `PLAN_REPO_CWD`.
  - Approved-plan export groups sync and reference files.
- Update the workspace UI:
  - Metadata card shows sync file, reference files, and total file count.
  - Edit mode includes a small multi-file editor with role selector, path input, add, and remove controls.
  - Save sends `files`; read-only mode remains display-only.
- Extract duplicated SSE load/reconnect code into a shared client helper for home and workspace pages, with cleanup on unmount, focus reload, and 2-second fallback polling only while disconnected.
- Keep all `app/api/w/[workspace]/**` handlers on `runtime = "nodejs"`, `dynamic = "force-dynamic"`, and async `params`.

## Test Plan

- DB tests for migration/backfill, file normalization, legacy field compatibility, transactional plan/file updates, and invalid path rejection.
- API tests for `PUT` with `files`, legacy `linkedFile`/`referencedFiles`, export JSON/Markdown, and 400 responses for invalid file payloads.
- Plugin utility tests for sync-file precedence, unsafe path rejection, and default sync path behavior.
- CLI/script tests or covered helper tests for `--sync-file`, `--linked-file`, and repeated `--ref`.
- UI tests for rendering file counts, editing multiple files, preserving read-only behavior, and SSE fallback cleanup.
- Final gates: `pnpm typecheck && pnpm lint && pnpm test`.

## Assumptions

- "Multiple files" means multiple files associated with a workspace, not multiple concurrent plan documents.
- V1 allows at most one sync file per workspace; reference files are many.
- Existing clients must continue to work without immediate migration.
