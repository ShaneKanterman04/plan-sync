import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertTransition } from "@/lib/schema";
import type {
  Author,
  DocumentType,
  Message,
  MessageKind,
  Plan,
  PollSnapshot,
  Revision,
  Status,
  WorkspaceSummary,
} from "@/lib/types";

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
CREATE INDEX IF NOT EXISTS idx_messages_ws ON messages(workspace, created_at);
CREATE INDEX IF NOT EXISTS idx_revisions_ws ON revisions(workspace, version);
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

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
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

function planRow(row: any): Plan {
  return {
    workspace: row.workspace,
    title: row.title,
    bodyMd: row.body_md,
    documentType: row.document_type,
    linkedFile: row.linked_file,
    sourceBranch: row.source_branch,
    sourceSha: row.source_sha,
    referencedFiles: parseFileList(row.referenced_files),
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
    const linkedFile =
      input.linkedFile !== undefined ? cleanLine(input.linkedFile, 500) : current?.linkedFile ?? "";
    const sourceBranch =
      input.sourceBranch !== undefined
        ? cleanLine(input.sourceBranch, 120)
        : current?.sourceBranch ?? "";
    const sourceSha =
      input.sourceSha !== undefined ? cleanLine(input.sourceSha, 80) : current?.sourceSha ?? "";
    const referencedFiles =
      input.referencedFiles !== undefined
        ? cleanFileList(input.referencedFiles)
        : current?.referencedFiles ?? [];
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
  });
  tx();
  return getPlan(input.workspace)!;
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

export function getMessages(workspace: string, sinceIso?: string): Message[] {
  if (sinceIso) {
    return db
      .prepare(
        "SELECT * FROM messages WHERE workspace = ? AND created_at > ? ORDER BY created_at, id",
      )
      .all(workspace, sinceIso)
      .map(messageRow);
  }
  return db
    .prepare("SELECT * FROM messages WHERE workspace = ? ORDER BY created_at, id")
    .all(workspace)
    .map(messageRow);
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

function proofSection(input: {
  commits: string[];
  validations: string[];
  runIds: string[];
  notes: string[];
}) {
  const lines = ["## Final Proof", "", `Generated: ${now()}`, ""];
  const sections: Array<[string, string[]]> = [
    ["Commits", input.commits],
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
  validations: string[];
  runIds: string[];
  notes: string[];
}): { plan: Plan; message: Message; proofMd: string } {
  const current = ensurePlan(input.workspace);
  const proofMd = proofSection(input);
  const body = `${current.bodyMd.trimEnd()}\n\n${proofMd}\n`;
  const plan = putPlanBody({
    workspace: input.workspace,
    title: current.title,
    bodyMd: body,
    author: input.author,
    documentType: current.documentType,
    linkedFile: current.linkedFile,
    sourceBranch: current.sourceBranch,
    sourceSha: current.sourceSha,
    referencedFiles: current.referencedFiles,
  });
  const message = addMessage({
    workspace: input.workspace,
    author: input.author,
    kind: "proof",
    body: "Final proof bundle added to the plan.",
  });
  return { plan, message, proofMd };
}

// --- revisions (history) ---

export function getRevisions(workspace: string, limit = 50): Revision[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  return db
    .prepare("SELECT * FROM revisions WHERE workspace = ? ORDER BY version DESC LIMIT ?")
    .all(workspace, capped)
    .map(revisionRow);
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
