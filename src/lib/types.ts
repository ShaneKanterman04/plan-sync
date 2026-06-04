export type Author = "agent" | "human";

export const DOCUMENT_TYPES = ["plan", "summary", "retrospective"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

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

export type Message = {
  id: string;
  workspace: string;
  author: Author;
  kind: MessageKind;
  body: string;
  createdAt: string;
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
