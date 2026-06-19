export type Author = "agent" | "human";

export const DOCUMENT_TYPES = ["plan", "summary", "retrospective"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const WORKSPACE_FILE_ROLES = ["sync", "reference"] as const;
export type WorkspaceFileRole = (typeof WORKSPACE_FILE_ROLES)[number];

export type WorkspaceFile = {
  path: string;
  role: WorkspaceFileRole;
};

export const STATUSES = [
  "draft",
  "review",
  "changes_requested",
  "approved",
  "implementing",
  "done",
] as const;
export type Status = (typeof STATUSES)[number];

export const MESSAGE_KINDS = [
  "note",
  "approve",
  "request_changes",
  "check",
  "progress",
  "proof",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const REACTION_EMOJIS = ["👍", "👀", "✅", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export type ReactionSummary = {
  emoji: ReactionEmoji;
  count: number;
  mine?: boolean;
};

export type Reaction = {
  id: string;
  workspace: string;
  messageId: string;
  emoji: ReactionEmoji;
  author: Author;
  createdAt: string;
};

export const WEBHOOK_EVENTS = ["plan", "status", "message", "proof"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type Webhook = {
  id: string;
  workspace: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhookPayload = {
  workspace: string;
  event: WebhookEvent;
  version: number;
  status: Status;
  at: string;
  messageId?: string;
};

export const PLUGIN_RUN_STATES = [
  "waiting",
  "approved",
  "preflight",
  "implementing",
  "interrupted",
  "failed",
  "done",
] as const;
export type PluginRunState = (typeof PLUGIN_RUN_STATES)[number];

/** One living plan document per workspace. `workspace` is the primary key. */
export type Plan = {
  workspace: string;
  title: string;
  bodyMd: string;
  documentType: DocumentType;
  linkedFile: string;
  files: WorkspaceFile[];
  sourceBranch: string;
  sourceSha: string;
  referencedFiles: string[];
  approvedVersion: number | null;
  approvedBranch: string;
  approvedSha: string;
  approvedAt: string | null;
  status: Status;
  /** Bumps on every body change (a human edit or agent rewrite). */
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: Author;
};

/**
 * An additional shared document in a workspace (beyond the primary plan). Stored
 * in the `documents` table; published by the agent for the human to browse and
 * discuss. Non-plan docs (summary/retrospective/reference) skip the approval
 * lifecycle — they are publish-and-read. `isPrimary` is false for these; the
 * workspace's primary plan is surfaced as a Document with `isPrimary: true`.
 */
export type Document = {
  workspace: string;
  docId: string;
  slug: string;
  title: string;
  documentType: DocumentType;
  bodyMd: string;
  version: number;
  isPrimary: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: Author;
};

/** Lightweight document entry for the workspace's document list. */
export type DocumentSummary = {
  docId: string;
  slug: string;
  title: string;
  documentType: DocumentType;
  version: number;
  isPrimary: boolean;
  archived: boolean;
  status: Status | null;
  updatedAt: string;
  updatedBy: Author;
  messageCount: number;
  lastMessageAt: string | null;
};

export type Message = {
  id: string;
  workspace: string;
  author: Author;
  kind: MessageKind;
  body: string;
  createdAt: string;
  reactions?: ReactionSummary[];
};

export type PluginRun = {
  id: string;
  workspace: string;
  agentName: string;
  state: PluginRunState;
  planVersion: number | null;
  approvedVersion: number | null;
  approvedBranch: string;
  approvedSha: string;
  approvedAt: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  errorText: string;
};

/** Append-only snapshot taken on each body change, for history/diffing. */
export type Revision = {
  id: string;
  workspace: string;
  version: number;
  bodyMd: string;
  status: Status;
  author: Author;
  note: string;
  createdAt: string;
};

export type WorkspaceSummary = {
  workspace: string;
  title: string;
  documentType: DocumentType;
  linkedFile: string;
  primaryFile: string;
  files: WorkspaceFile[];
  fileCount: number;
  status: Status;
  version: number;
  updatedAt: string;
  updatedBy: Author;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  staleReasons: string[];
};

/** The cheap snapshot agents poll to detect a human response. */
export type PollSnapshot = {
  status: Status;
  version: number;
  updatedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
};
