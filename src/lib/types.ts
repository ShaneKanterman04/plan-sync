export type Author = "agent" | "human";

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
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** One living plan document per workspace. `workspace` is the primary key. */
export type Plan = {
  workspace: string;
  title: string;
  bodyMd: string;
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
  status: Status;
  version: number;
  updatedAt: string;
  updatedBy: Author;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
};

/** The cheap snapshot agents poll to detect a human response. */
export type PollSnapshot = {
  status: Status;
  version: number;
  updatedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
};
