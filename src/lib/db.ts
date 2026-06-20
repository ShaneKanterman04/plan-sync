import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertTransition } from "@/lib/schema";
import {
  REACTION_EMOJIS,
  type Author,
  type Document,
  type DocumentSummary,
  type DocumentType,
  type Message,
  type MessageKind,
  type Plan,
  type PluginRun,
  type PluginRunState,
  type PollSnapshot,
  type Reaction,
  type ReactionEmoji,
  type ReactionSummary,
  type Revision,
  type Status,
  type Webhook,
  type WebhookEvent,
  type WorkspaceFile,
  type WorkspaceSummary,
} from "@/lib/types";
import {
  normalizeWorkspaceFiles,
  referenceFilesFromFiles,
  syncFileFromFiles,
  workspaceFilesFromLegacy,
} from "@/lib/workspace-files";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "plansync.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  workspace TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'agent'
);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL REFERENCES plans(workspace) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body_md TEXT NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(workspace, version)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL REFERENCES plans(workspace) ON DELETE CASCADE,
  author TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_runs (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL REFERENCES plans(workspace) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  state TEXT NOT NULL,
  plan_version INTEGER,
  approved_version INTEGER,
  approved_branch TEXT NOT NULL DEFAULT '',
  approved_sha TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  error_text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plan_files (
  workspace TEXT NOT NULL REFERENCES plans(workspace) ON DELETE CASCADE,
  path TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace, path)
);
CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL REFERENCES plans(workspace) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(message_id, emoji, author)
);
CREATE INDEX IF NOT EXISTS idx_reactions_ws ON reactions(workspace);
CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(message_id);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL REFERENCES plans(workspace) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_ws ON webhooks(workspace, active);
CREATE INDEX IF NOT EXISTS idx_messages_ws ON messages(workspace, created_at);
CREATE INDEX IF NOT EXISTS idx_revisions_ws ON revisions(workspace, version);
CREATE INDEX IF NOT EXISTS idx_plugin_runs_ws ON plugin_runs(workspace, updated_at);
CREATE INDEX IF NOT EXISTS idx_plan_files_ws ON plan_files(workspace, role, path);
CREATE TABLE IF NOT EXISTS documents (
  workspace TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT 'summary',
  version INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'agent',
  PRIMARY KEY (workspace, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_documents_ws ON documents(workspace, archived, updated_at);
CREATE TABLE IF NOT EXISTS document_messages (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace, doc_id) REFERENCES documents(workspace, doc_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_document_messages ON document_messages(workspace, doc_id, created_at);
`);

function existingColumns(table: string) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row: any) => String(row.name)),
  );
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (existingColumns(table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("plans", "document_type", "TEXT NOT NULL DEFAULT 'plan'");
addColumnIfMissing("plans", "linked_file", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("plans", "source_branch", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("plans", "source_sha", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("plans", "referenced_files", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("plans", "approved_version", "INTEGER");
addColumnIfMissing("plans", "approved_branch", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("plans", "approved_sha", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("plans", "approved_at", "TEXT");

function backfillPlanFiles() {
  const rows = db.prepare("SELECT workspace, linked_file, referenced_files FROM plans").all() as Array<{
    workspace: string;
    linked_file: string;
    referenced_files: string;
  }>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO plan_files (workspace, path, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      let files: WorkspaceFile[] = [];
      try {
        files = workspaceFilesFromLegacy({
          linkedFile: row.linked_file,
          referencedFiles: parseFileList(row.referenced_files),
        });
      } catch {
        files = [];
      }
      const at = now();
      for (const file of files) insert.run(row.workspace, file.path, file.role, at, at);
    }
  });
  tx();
}

const MAX_WEBHOOKS_PER_WORKSPACE = 20;

function id() {
  return crypto.randomUUID();
}

// Monotonic ISO-8601 clock: guarantees strictly increasing timestamps even when
// two calls land in the same millisecond. Without this, rows created in rapid
// succession share a created_at, which breaks `created_at > ?` since-filters
// (e.g. getMessages would drop a message that ties the cursor timestamp).
let lastNowMs = 0;
function now() {
  let ms = Date.now();
  if (ms <= lastNowMs) ms = lastNowMs + 1;
  lastNowMs = ms;
  return new Date(ms).toISOString();
}

/** Single-line clean: trim, collapse whitespace, cap length. */
function cleanLine(input: unknown, max = 120) {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

/** Multi-line clean: trim ends, preserve internal newlines, cap length. */
function cleanBody(input: unknown, max = 10_000) {
  return String(input ?? "").trim().slice(0, max);
}

function cleanFileList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    const path = cleanLine(value, 500);
    if (path) seen.add(path);
  }
  return [...seen].slice(0, 200);
}

function parseFileList(input: unknown): string[] {
  if (typeof input !== "string" || !input.trim()) return [];
  try {
    return cleanFileList(JSON.parse(input));
  } catch {
    return [];
  }
}

backfillPlanFiles();

export function staleReasons(plan: Pick<
  Plan,
  | "status"
  | "version"
  | "sourceBranch"
  | "sourceSha"
  | "approvedVersion"
  | "approvedBranch"
  | "approvedSha"
>): string[] {
  if (!["approved", "implementing", "done"].includes(plan.status)) return [];
  const reasons: string[] = [];
  if (plan.approvedVersion !== null && plan.version > plan.approvedVersion) {
    reasons.push(`plan changed after approval: v${plan.approvedVersion} → v${plan.version}`);
  }
  if (plan.approvedSha && plan.sourceSha && plan.approvedSha !== plan.sourceSha) {
    reasons.push(`git SHA changed after approval: ${plan.approvedSha} → ${plan.sourceSha}`);
  }
  if (plan.approvedBranch && plan.sourceBranch && plan.approvedBranch !== plan.sourceBranch) {
    reasons.push(
      `git branch changed after approval: ${plan.approvedBranch} → ${plan.sourceBranch}`,
    );
  }
  return reasons;
}

// --- row mappers (snake_case row -> camelCase domain type) ---

function getWorkspaceFiles(workspace: string): WorkspaceFile[] {
  return (
    db
      .prepare("SELECT path, role FROM plan_files WHERE workspace = ? ORDER BY role = 'sync' DESC, path")
      .all(workspace) as Array<{ path: string; role: WorkspaceFile["role"] }>
  ).map((row) => ({ path: row.path, role: row.role }));
}

function planRow(row: any): Plan {
  const files = getWorkspaceFiles(row.workspace);
  const linkedFile = syncFileFromFiles(files) || row.linked_file;
  const referencedFiles = files.length
    ? referenceFilesFromFiles(files)
    : parseFileList(row.referenced_files);
  let derivedFiles = files;
  if (!derivedFiles.length) {
    try {
      derivedFiles = workspaceFilesFromLegacy({ linkedFile, referencedFiles });
    } catch {
      derivedFiles = [];
    }
  }
  return {
    workspace: row.workspace,
    title: row.title,
    bodyMd: row.body_md,
    documentType: row.document_type,
    linkedFile,
    files: derivedFiles,
    sourceBranch: row.source_branch,
    sourceSha: row.source_sha,
    referencedFiles,
    approvedVersion: row.approved_version === null ? null : Number(row.approved_version),
    approvedBranch: row.approved_branch,
    approvedSha: row.approved_sha,
    approvedAt: row.approved_at,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function messageRow(row: any): Message {
  return {
    id: row.id,
    workspace: row.workspace,
    author: row.author,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  };
}

function pluginRunRow(row: any): PluginRun {
  return {
    id: row.id,
    workspace: row.workspace,
    agentName: row.agent_name,
    state: row.state,
    planVersion: row.plan_version === null ? null : Number(row.plan_version),
    approvedVersion: row.approved_version === null ? null : Number(row.approved_version),
    approvedBranch: row.approved_branch,
    approvedSha: row.approved_sha,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    errorText: row.error_text,
  };
}

function revisionRow(row: any): Revision {
  return {
    id: row.id,
    workspace: row.workspace,
    version: row.version,
    bodyMd: row.body_md,
    status: row.status,
    author: row.author,
    note: row.note,
    createdAt: row.created_at,
  };
}

function parseWebhookEvents(input: unknown): WebhookEvent[] {
  if (typeof input !== "string" || !input.trim()) return [];
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is WebhookEvent =>
        value === "plan" || value === "status" || value === "message" || value === "proof",
    );
  } catch {
    return [];
  }
}

function webhookRow(row: any): Webhook {
  return {
    id: row.id,
    workspace: row.workspace,
    url: row.url,
    secret: row.secret,
    events: parseWebhookEvents(row.events),
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Aggregate every reaction in a workspace into a per-message summary in a SINGLE
 * query (no N+1). `viewer` flags whether the viewer owns each reaction emoji.
 */
function getReactionsByMessage(
  workspace: string,
  viewer?: Author,
): Map<string, ReactionSummary[]> {
  const rows = db
    .prepare(
      "SELECT message_id, emoji, author FROM reactions WHERE workspace = ?",
    )
    .all(workspace) as Array<{ message_id: string; emoji: string; author: Author }>;

  // message_id -> emoji -> { count, mine }
  const byMessage = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const row of rows) {
    let perEmoji = byMessage.get(row.message_id);
    if (!perEmoji) {
      perEmoji = new Map();
      byMessage.set(row.message_id, perEmoji);
    }
    const entry = perEmoji.get(row.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (viewer !== undefined && row.author === viewer) entry.mine = true;
    perEmoji.set(row.emoji, entry);
  }

  const result = new Map<string, ReactionSummary[]>();
  for (const [messageId, perEmoji] of byMessage) {
    const summaries: ReactionSummary[] = [];
    for (const emoji of REACTION_EMOJIS) {
      const entry = perEmoji.get(emoji);
      if (!entry) continue;
      const summary: ReactionSummary = { emoji, count: entry.count };
      if (viewer !== undefined) summary.mine = entry.mine;
      summaries.push(summary);
    }
    result.set(messageId, summaries);
  }
  return result;
}

// --- workspaces ---

export function listWorkspaces(): WorkspaceSummary[] {
  const plans = db.prepare("SELECT * FROM plans ORDER BY updated_at DESC").all().map(planRow);
  const stats = db.prepare(
    "SELECT COUNT(*) AS count, MAX(created_at) AS last FROM messages WHERE workspace = ?",
  );
  const lastMsg = db.prepare(
    "SELECT body FROM messages WHERE workspace = ? ORDER BY created_at DESC, id DESC LIMIT 1",
  );
  return plans.map((p) => {
    const s = stats.get(p.workspace) as any;
    const m = lastMsg.get(p.workspace) as any;
    return {
      workspace: p.workspace,
      title: p.title,
      documentType: p.documentType,
      linkedFile: p.linkedFile,
      primaryFile: p.linkedFile || p.referencedFiles[0] || "",
      files: p.files,
      fileCount: p.files.length,
      status: p.status,
      version: p.version,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
      messageCount: Number(s?.count ?? 0),
      lastMessageAt: s?.last ?? null,
      lastMessagePreview: m ? cleanLine(m.body, 80) : null,
      staleReasons: staleReasons(p),
    };
  });
}

// --- plan (one per workspace) ---

export function getPlan(workspace: string): Plan | null {
  const row = db.prepare("SELECT * FROM plans WHERE workspace = ?").get(workspace);
  return row ? planRow(row) : null;
}

/** Create an empty draft (version 0) if the workspace has no plan yet. */
export function ensurePlan(workspace: string): Plan {
  const existing = getPlan(workspace);
  if (existing) return existing;
  const at = now();
  db.prepare(
    `INSERT INTO plans (workspace, title, body_md, status, version, created_at, updated_at, updated_by)
     VALUES (?, '', '', 'draft', 0, ?, ?, 'agent')`,
  ).run(workspace, at, at);
  return getPlan(workspace)!;
}

/** Write the plan body. Bumps version and snapshots a revision atomically. */
export function putPlanBody(input: {
  workspace: string;
  title?: string;
  bodyMd: string;
  author: Author;
  documentType?: DocumentType;
  linkedFile?: string;
  files?: WorkspaceFile[];
  sourceBranch?: string;
  sourceSha?: string;
  referencedFiles?: string[];
}): Plan {
  const at = now();
  const tx = db.transaction(() => {
    const current = getPlan(input.workspace);
    const nextVersion = (current?.version ?? 0) + 1;
    const title = input.title !== undefined ? cleanLine(input.title, 120) : current?.title ?? "";
    const body = String(input.bodyMd ?? "").slice(0, 200_000);
    const documentType = input.documentType ?? current?.documentType ?? "plan";
    const files =
      input.files !== undefined
        ? normalizeWorkspaceFiles(input.files)
        : workspaceFilesFromLegacy({
            linkedFile:
              input.linkedFile !== undefined
                ? cleanLine(input.linkedFile, 500)
                : current?.linkedFile ?? "",
            referencedFiles:
              input.referencedFiles !== undefined
                ? cleanFileList(input.referencedFiles)
                : current?.referencedFiles ?? [],
          });
    const linkedFile = syncFileFromFiles(files);
    const sourceBranch =
      input.sourceBranch !== undefined
        ? cleanLine(input.sourceBranch, 120)
        : current?.sourceBranch ?? "";
    const sourceSha =
      input.sourceSha !== undefined ? cleanLine(input.sourceSha, 80) : current?.sourceSha ?? "";
    const referencedFiles = referenceFilesFromFiles(files);
    const status = current?.status ?? "draft";
    const createdAt = current?.createdAt ?? at;
    db.prepare(
      `INSERT INTO plans (
         workspace, title, body_md, document_type, linked_file, source_branch, source_sha,
         referenced_files, status, version, created_at, updated_at, updated_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace) DO UPDATE SET
         title = excluded.title,
         body_md = excluded.body_md,
         document_type = excluded.document_type,
         linked_file = excluded.linked_file,
         source_branch = excluded.source_branch,
         source_sha = excluded.source_sha,
         referenced_files = excluded.referenced_files,
         version = excluded.version,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).run(
      input.workspace,
      title,
      body,
      documentType,
      linkedFile,
      sourceBranch,
      sourceSha,
      JSON.stringify(referencedFiles),
      status,
      nextVersion,
      createdAt,
      at,
      input.author,
    );
    db.prepare(
      `INSERT INTO revisions (id, workspace, version, body_md, status, author, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
    ).run(id(), input.workspace, nextVersion, body, status, input.author, at);
    db.prepare("DELETE FROM plan_files WHERE workspace = ?").run(input.workspace);
    const insertFile = db.prepare(
      `INSERT INTO plan_files (workspace, path, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const file of files) insertFile.run(input.workspace, file.path, file.role, at, at);
  });
  tx();
  return getPlan(input.workspace)!;
}

export function appendWorkspaceFiles(input: {
  workspace: string;
  author: Author;
  files: WorkspaceFile[];
  note?: string;
}): { plan: Plan; message: Message | null } {
  const current = ensurePlan(input.workspace);
  const plan = putPlanBody({
    workspace: input.workspace,
    author: input.author,
    bodyMd: current.bodyMd,
    files: [...current.files, ...input.files],
  });
  const note = input.note?.trim();
  const message = note
    ? addMessage({ workspace: input.workspace, author: input.author, kind: "note", body: note })
    : null;
  return { plan, message };
}

// --- status lifecycle ---

export function getStatus(
  workspace: string,
): { status: Status; version: number; updatedAt: string } | null {
  const row = db
    .prepare("SELECT status, version, updated_at FROM plans WHERE workspace = ?")
    .get(workspace) as any;
  return row ? { status: row.status, version: row.version, updatedAt: row.updated_at } : null;
}

function statusMessageKind(status: Status): MessageKind | null {
  switch (status) {
    case "approved":
      return "approve";
    case "changes_requested":
      return "request_changes";
    case "implementing":
    case "done":
      return "progress";
    default:
      return null;
  }
}

function defaultStatusMessage(status: Status, author: Author): string {
  const who = author === "agent" ? "Agent" : "Human";
  switch (status) {
    case "approved":
      return `${who} approved the plan.`;
    case "changes_requested":
      return `${who} requested changes.`;
    case "implementing":
      return `${who} started implementing.`;
    case "done":
      return `${who} marked the plan done.`;
    default:
      return "";
  }
}

/** Change status (transition-checked). Logs a message for meaningful moves. */
export function setStatus(input: {
  workspace: string;
  status: Status;
  author: Author;
  note?: string;
}): Plan {
  const at = now();
  const plan = ensurePlan(input.workspace);
  assertTransition(plan.status, input.status);
  const tx = db.transaction(() => {
    if (input.status === "approved") {
      db.prepare(
        `UPDATE plans SET
           status = ?, updated_at = ?, updated_by = ?,
           approved_version = ?, approved_branch = ?, approved_sha = ?, approved_at = ?
         WHERE workspace = ?`,
      ).run(
        input.status,
        at,
        input.author,
        plan.version,
        plan.sourceBranch,
        plan.sourceSha,
        at,
        input.workspace,
      );
    } else if (["draft", "review", "changes_requested"].includes(input.status)) {
      db.prepare(
        `UPDATE plans SET
           status = ?, updated_at = ?, updated_by = ?,
           approved_version = NULL, approved_branch = '', approved_sha = '', approved_at = NULL
         WHERE workspace = ?`,
      ).run(input.status, at, input.author, input.workspace);
    } else {
      db.prepare(
        "UPDATE plans SET status = ?, updated_at = ?, updated_by = ? WHERE workspace = ?",
      ).run(input.status, at, input.author, input.workspace);
    }
    const kind = statusMessageKind(input.status);
    const note = input.note?.trim();
    if (kind) {
      const body = note || defaultStatusMessage(input.status, input.author);
      db.prepare(
        "INSERT INTO messages (id, workspace, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id(), input.workspace, input.author, kind, body, at);
    } else if (note) {
      db.prepare(
        "INSERT INTO messages (id, workspace, author, kind, body, created_at) VALUES (?, ?, ?, 'note', ?, ?)",
      ).run(id(), input.workspace, input.author, note, at);
    }
  });
  tx();
  return getPlan(input.workspace)!;
}

// --- messages ---

export function getMessages(
  workspace: string,
  sinceIso?: string,
  viewer?: Author,
): Message[] {
  const reactions = getReactionsByMessage(workspace, viewer);
  if (sinceIso) {
    return db
      .prepare(
        "SELECT * FROM messages WHERE workspace = ? AND created_at > ? ORDER BY created_at, id",
      )
      .all(workspace, sinceIso)
      .map(messageRow)
      .map((m) => ({ ...m, reactions: reactions.get(m.id) ?? [] }));
  }
  return db
    .prepare("SELECT * FROM messages WHERE workspace = ? ORDER BY created_at, id")
    .all(workspace)
    .map(messageRow)
    .map((m) => ({ ...m, reactions: reactions.get(m.id) ?? [] }));
}

export function addMessage(input: {
  workspace: string;
  author: Author;
  kind?: MessageKind;
  body: string;
}): Message {
  ensurePlan(input.workspace);
  const message: Message = {
    id: id(),
    workspace: input.workspace,
    author: input.author,
    kind: input.kind ?? "note",
    body: cleanBody(input.body),
    createdAt: now(),
  };
  db.prepare(
    "INSERT INTO messages (id, workspace, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(message.id, message.workspace, message.author, message.kind, message.body, message.createdAt);
  return message;
}

// --- reactions ---

/**
 * Toggle a single (message, emoji, author) reaction. Returns `"on"` with the
 * created row when it was added, or `"off"` with `null` when removed. Throws a
 * 400-style error if the message does not exist in the workspace.
 */
export function toggleReaction(input: {
  workspace: string;
  messageId: string;
  emoji: ReactionEmoji;
  author: Author;
}): { toggled: "on" | "off"; reaction: Reaction | null } {
  ensurePlan(input.workspace);
  const exists = db
    .prepare("SELECT 1 FROM messages WHERE id = ? AND workspace = ?")
    .get(input.messageId, input.workspace);
  if (!exists) {
    throw new Error("message not found");
  }
  const tx = db.transaction(() => {
    const current = db
      .prepare(
        "SELECT * FROM reactions WHERE message_id = ? AND emoji = ? AND author = ?",
      )
      .get(input.messageId, input.emoji, input.author);
    if (current) {
      db.prepare(
        "DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND author = ?",
      ).run(input.messageId, input.emoji, input.author);
      return { toggled: "off" as const, reaction: null };
    }
    const reaction: Reaction = {
      id: id(),
      workspace: input.workspace,
      messageId: input.messageId,
      emoji: input.emoji,
      author: input.author,
      createdAt: now(),
    };
    db.prepare(
      "INSERT INTO reactions (id, workspace, message_id, emoji, author, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      reaction.id,
      reaction.workspace,
      reaction.messageId,
      reaction.emoji,
      reaction.author,
      reaction.createdAt,
    );
    return { toggled: "on" as const, reaction };
  });
  return tx();
}

// --- webhooks ---

/** Append-only webhook registration, capped at MAX_WEBHOOKS_PER_WORKSPACE. */
export function createWebhook(input: {
  workspace: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  active?: boolean;
}): Webhook {
  ensurePlan(input.workspace);
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM webhooks WHERE workspace = ?")
    .get(input.workspace) as { count: number };
  if (Number(count?.count ?? 0) >= MAX_WEBHOOKS_PER_WORKSPACE) {
    throw new Error(
      `webhook limit reached for workspace (max ${MAX_WEBHOOKS_PER_WORKSPACE})`,
    );
  }
  const at = now();
  const webhook: Webhook = {
    id: id(),
    workspace: input.workspace,
    url: input.url,
    secret: input.secret ?? "",
    events: input.events,
    active: input.active === false ? false : true,
    createdAt: at,
    updatedAt: at,
  };
  db.prepare(
    `INSERT INTO webhooks (id, workspace, url, secret, events, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    webhook.id,
    webhook.workspace,
    webhook.url,
    webhook.secret,
    JSON.stringify(webhook.events),
    webhook.active ? 1 : 0,
    webhook.createdAt,
    webhook.updatedAt,
  );
  return webhook;
}

export function listWebhooks(workspace: string): Webhook[] {
  return db
    .prepare("SELECT * FROM webhooks WHERE workspace = ? ORDER BY created_at, id")
    .all(workspace)
    .map(webhookRow);
}

export function listActiveWebhooks(workspace: string): Webhook[] {
  return db
    .prepare(
      "SELECT * FROM webhooks WHERE workspace = ? AND active = 1 ORDER BY created_at, id",
    )
    .all(workspace)
    .map(webhookRow);
}

export function deleteWebhook(workspace: string, id: string): boolean {
  const result = db
    .prepare("DELETE FROM webhooks WHERE workspace = ? AND id = ?")
    .run(workspace, id);
  return result.changes > 0;
}

// --- plugin runs ---

export function createPluginRun(input: {
  id?: string;
  workspace: string;
  agentName: string;
  state?: PluginRunState;
  planVersion?: number | null;
  approvedVersion?: number | null;
  approvedBranch?: string;
  approvedSha?: string;
  approvedAt?: string | null;
}): PluginRun {
  ensurePlan(input.workspace);
  const at = now();
  const runId = cleanLine(input.id || id(), 120);
  db.prepare(
    `INSERT INTO plugin_runs (
       id, workspace, agent_name, state, plan_version, approved_version,
       approved_branch, approved_sha, approved_at, started_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       agent_name = excluded.agent_name,
       state = excluded.state,
       plan_version = excluded.plan_version,
       approved_version = excluded.approved_version,
       approved_branch = excluded.approved_branch,
       approved_sha = excluded.approved_sha,
       approved_at = excluded.approved_at,
       updated_at = excluded.updated_at`,
  ).run(
    runId,
    input.workspace,
    cleanLine(input.agentName, 120),
    input.state ?? "waiting",
    input.planVersion ?? null,
    input.approvedVersion ?? null,
    cleanLine(input.approvedBranch, 120),
    cleanLine(input.approvedSha, 80),
    input.approvedAt ?? null,
    at,
    at,
  );
  return getPluginRun(input.workspace, runId)!;
}

export function updatePluginRun(input: {
  workspace: string;
  id: string;
  state?: PluginRunState;
  planVersion?: number | null;
  approvedVersion?: number | null;
  approvedBranch?: string;
  approvedSha?: string;
  approvedAt?: string | null;
  endedAt?: string | null;
  exitCode?: number | null;
  errorText?: string;
}): PluginRun {
  const current = getPluginRun(input.workspace, input.id);
  if (!current) {
    throw new Error(`Plugin run not found: ${input.id}`);
  }
  const at = now();
  db.prepare(
    `UPDATE plugin_runs SET
       state = ?,
       plan_version = ?,
       approved_version = ?,
       approved_branch = ?,
       approved_sha = ?,
       approved_at = ?,
       updated_at = ?,
       ended_at = ?,
       exit_code = ?,
       error_text = ?
     WHERE workspace = ? AND id = ?`,
  ).run(
    input.state ?? current.state,
    input.planVersion !== undefined ? input.planVersion : current.planVersion,
    input.approvedVersion !== undefined ? input.approvedVersion : current.approvedVersion,
    input.approvedBranch !== undefined ? cleanLine(input.approvedBranch, 120) : current.approvedBranch,
    input.approvedSha !== undefined ? cleanLine(input.approvedSha, 80) : current.approvedSha,
    input.approvedAt !== undefined ? input.approvedAt : current.approvedAt,
    at,
    input.endedAt !== undefined ? input.endedAt : current.endedAt,
    input.exitCode !== undefined ? input.exitCode : current.exitCode,
    input.errorText !== undefined ? cleanBody(input.errorText, 2_000) : current.errorText,
    input.workspace,
    input.id,
  );
  return getPluginRun(input.workspace, input.id)!;
}

export function getPluginRun(workspace: string, id: string): PluginRun | null {
  const row = db
    .prepare("SELECT * FROM plugin_runs WHERE workspace = ? AND id = ?")
    .get(workspace, id);
  return row ? pluginRunRow(row) : null;
}

export function listPluginRuns(workspace: string, limit = 20): PluginRun[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 20, 1), 200);
  return db
    .prepare("SELECT * FROM plugin_runs WHERE workspace = ? ORDER BY updated_at DESC LIMIT ?")
    .all(workspace, capped)
    .map(pluginRunRow);
}

function proofSection(input: {
  commits: string[];
  changedFiles: string[];
  validations: string[];
  runIds: string[];
  notes: string[];
}) {
  const lines = ["## Final Proof", "", `Generated: ${now()}`, ""];
  const sections: Array<[string, string[]]> = [
    ["Commits", input.commits],
    ["Changed Files", input.changedFiles],
    ["Validation", input.validations],
    ["CI Run IDs", input.runIds],
    ["Notes", input.notes],
  ];
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function appendProof(input: {
  workspace: string;
  author: Author;
  commits: string[];
  changedFiles: string[];
  validations: string[];
  runIds: string[];
  notes: string[];
}): { plan: Plan; message: Message; proofMd: string } {
  const current = ensurePlan(input.workspace);
  const proofMd = proofSection(input);
  const message = addMessage({
    workspace: input.workspace,
    author: input.author,
    kind: "proof",
    body: proofMd,
  });
  return { plan: current, message, proofMd };
}

// --- revisions (history) ---

export function getRevisions(workspace: string, limit = 50): Revision[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  return db
    .prepare("SELECT * FROM revisions WHERE workspace = ? ORDER BY version DESC LIMIT ?")
    .all(workspace, capped)
    .map(revisionRow);
}

// --- documents (additional shared docs beyond the primary plan) ---
//
// The workspace's primary plan still lives in `plans` (approve-flow intact); this
// layer adds extra agent-published docs the human browses + discusses. The two
// are merged into one document list by listWorkspaceDocuments().

/** Reserved doc id for the workspace's primary plan in the unified list. */
export const PRIMARY_DOC_ID = "primary";

function slugify(input: unknown): string {
  const base = String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "doc";
}

function documentRow(row: any): Document {
  return {
    workspace: row.workspace,
    docId: row.doc_id,
    slug: row.slug,
    title: row.title,
    documentType: row.document_type,
    bodyMd: row.body_md,
    version: Number(row.version),
    isPrimary: false,
    archived: Number(row.archived) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function getDocument(workspace: string, docId: string): Document | null {
  const row = db
    .prepare("SELECT * FROM documents WHERE workspace = ? AND doc_id = ?")
    .get(workspace, docId);
  return row ? documentRow(row) : null;
}

export function getDocumentBySlug(workspace: string, slug: string): Document | null {
  const row = db
    .prepare("SELECT * FROM documents WHERE workspace = ? AND slug = ? ORDER BY updated_at DESC LIMIT 1")
    .get(workspace, slugify(slug));
  return row ? documentRow(row) : null;
}

export function listExtraDocuments(workspace: string, includeArchived = false): Document[] {
  const sql = includeArchived
    ? "SELECT * FROM documents WHERE workspace = ? ORDER BY updated_at DESC, doc_id"
    : "SELECT * FROM documents WHERE workspace = ? AND archived = 0 ORDER BY updated_at DESC, doc_id";
  return db.prepare(sql).all(workspace).map(documentRow);
}

/**
 * Create or update an additional document. Identified by explicit `docId`, else
 * by a slug derived from `slug`/`title` (so re-publishing the same slug updates
 * in place). Bumps version on each write. Non-plan docs skip the approve flow.
 */
export function putDocument(input: {
  workspace: string;
  docId?: string;
  slug?: string;
  title: string;
  bodyMd: string;
  documentType?: DocumentType;
  author: Author;
}): Document {
  const slug = slugify(input.slug || input.title);
  // doc_id IS the slug (unless an explicit docId is given) so the CLI/API/user
  // all reference a document by the same human-readable handle; re-publishing the
  // same slug updates in place via the upsert below.
  const docId = input.docId ?? slug;
  const existing = getDocument(input.workspace, docId);
  const at = now();
  const nextVersion = (existing?.version ?? 0) + 1;
  const title = cleanLine(input.title, 120) || existing?.title || slug;
  const body = String(input.bodyMd ?? "").slice(0, 200_000);
  const documentType = input.documentType ?? existing?.documentType ?? "summary";
  const createdAt = existing?.createdAt ?? at;
  db.prepare(
    `INSERT INTO documents (
       workspace, doc_id, slug, title, body_md, document_type, version,
       archived, created_at, updated_at, updated_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(workspace, doc_id) DO UPDATE SET
       slug = excluded.slug,
       title = excluded.title,
       body_md = excluded.body_md,
       document_type = excluded.document_type,
       version = excluded.version,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(input.workspace, docId, slug, title, body, documentType, nextVersion, createdAt, at, input.author);
  return getDocument(input.workspace, docId)!;
}

export function archiveDocument(
  workspace: string,
  docId: string,
  archived: boolean,
): Document | null {
  const result = db
    .prepare("UPDATE documents SET archived = ?, updated_at = ? WHERE workspace = ? AND doc_id = ?")
    .run(archived ? 1 : 0, now(), workspace, docId);
  return result.changes > 0 ? getDocument(workspace, docId) : null;
}

export function deleteDocument(workspace: string, docId: string): boolean {
  const result = db
    .prepare("DELETE FROM documents WHERE workspace = ? AND doc_id = ?")
    .run(workspace, docId);
  return result.changes > 0;
}

export function getDocumentMessages(
  workspace: string,
  docId: string,
  sinceIso?: string,
): Message[] {
  const rows = sinceIso
    ? db
        .prepare(
          "SELECT * FROM document_messages WHERE workspace = ? AND doc_id = ? AND created_at > ? ORDER BY created_at, id",
        )
        .all(workspace, docId, sinceIso)
    : db
        .prepare(
          "SELECT * FROM document_messages WHERE workspace = ? AND doc_id = ? ORDER BY created_at, id",
        )
        .all(workspace, docId);
  return (rows as any[]).map((row) => ({
    id: row.id,
    workspace: row.workspace,
    author: row.author,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export function addDocumentMessage(input: {
  workspace: string;
  docId: string;
  author: Author;
  kind?: MessageKind;
  body: string;
}): Message {
  if (!getDocument(input.workspace, input.docId)) {
    throw new Error("document not found");
  }
  const message: Message = {
    id: id(),
    workspace: input.workspace,
    author: input.author,
    kind: input.kind ?? "note",
    body: cleanBody(input.body),
    createdAt: now(),
  };
  db.prepare(
    "INSERT INTO document_messages (id, workspace, doc_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(message.id, message.workspace, input.docId, message.author, message.kind, message.body, message.createdAt);
  return message;
}

/**
 * Unified document list for a workspace: the primary plan (from `plans`, if any)
 * pinned first as a Document with isPrimary=true, followed by the extra documents
 * newest-first. This is what the phone's document browser renders.
 */
export function listWorkspaceDocuments(
  workspace: string,
  includeArchived = false,
): DocumentSummary[] {
  const out: DocumentSummary[] = [];
  const planStats = db.prepare(
    "SELECT COUNT(*) AS count, MAX(created_at) AS last FROM messages WHERE workspace = ?",
  );
  const docStats = db.prepare(
    "SELECT COUNT(*) AS count, MAX(created_at) AS last FROM document_messages WHERE workspace = ? AND doc_id = ?",
  );
  const plan = getPlan(workspace);
  if (plan) {
    const s = planStats.get(workspace) as any;
    out.push({
      docId: PRIMARY_DOC_ID,
      slug: "plan",
      title: plan.title || "Plan",
      documentType: plan.documentType,
      version: plan.version,
      isPrimary: true,
      archived: false,
      status: plan.status,
      updatedAt: plan.updatedAt,
      updatedBy: plan.updatedBy,
      messageCount: Number(s?.count ?? 0),
      lastMessageAt: s?.last ?? null,
    });
  }
  for (const doc of listExtraDocuments(workspace, includeArchived)) {
    const s = docStats.get(workspace, doc.docId) as any;
    out.push({
      docId: doc.docId,
      slug: doc.slug,
      title: doc.title,
      documentType: doc.documentType,
      version: doc.version,
      isPrimary: false,
      archived: doc.archived,
      status: null,
      updatedAt: doc.updatedAt,
      updatedBy: doc.updatedBy,
      messageCount: Number(s?.count ?? 0),
      lastMessageAt: s?.last ?? null,
    });
  }
  return out;
}

// --- lightweight poll snapshot for agents ---

export function pollSnapshot(workspace: string): PollSnapshot | null {
  const plan = db
    .prepare("SELECT status, version, updated_at FROM plans WHERE workspace = ?")
    .get(workspace) as any;
  if (!plan) return null;
  const stats = db
    .prepare("SELECT COUNT(*) AS count, MAX(created_at) AS last FROM messages WHERE workspace = ?")
    .get(workspace) as any;
  return {
    status: plan.status,
    version: plan.version,
    updatedAt: plan.updated_at,
    messageCount: Number(stats?.count ?? 0),
    lastMessageAt: stats?.last ?? null,
  };
}

export { db };
