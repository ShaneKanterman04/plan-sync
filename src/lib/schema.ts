import { z } from "zod";
import { DOCUMENT_TYPES, MESSAGE_KINDS, STATUSES, type Status } from "@/lib/types";

export const authorSchema = z.enum(["agent", "human"]);
export const statusSchema = z.enum(STATUSES);
export const messageKindSchema = z.enum(MESSAGE_KINDS);
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Workspace names use only letters, numbers, dot, dash, and underscore.",
  );

export const putPlanSchema = z.object({
  author: authorSchema,
  title: z.string().trim().max(120).optional(),
  bodyMd: z.string().max(200_000),
  documentType: documentTypeSchema.optional(),
  linkedFile: z.string().trim().max(500).optional(),
  sourceBranch: z.string().trim().max(120).optional(),
  sourceSha: z.string().trim().max(80).optional(),
  referencedFiles: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
});

export const patchStatusSchema = z.object({
  author: authorSchema,
  status: statusSchema,
  note: z.string().trim().max(500).optional(),
});

export const postMessageSchema = z.object({
  author: authorSchema,
  kind: messageKindSchema.optional().default("note"),
  body: z.string().trim().min(1).max(10_000),
});

export const postProofSchema = z.object({
  author: authorSchema,
  commits: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  validations: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  runIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  notes: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});

/**
 * Legal status transitions. The lifecycle is:
 *   draft → review → {approved | changes_requested} → implementing → done
 * with sensible back-edges (revise, reopen). Author is informational in the
 * MVP, not gating — both agent and human may drive any legal transition.
 */
export const TRANSITIONS: Record<Status, Status[]> = {
  draft: ["review"],
  review: ["approved", "changes_requested", "draft"],
  changes_requested: ["review", "draft"],
  approved: ["implementing", "changes_requested"],
  implementing: ["done", "changes_requested"],
  done: ["implementing", "review"],
};

export function canTransition(from: Status, to: Status): boolean {
  if (from === to) return true; // idempotent no-op
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: Status, to: Status): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal status transition: ${from} → ${to}. Allowed from "${from}": ${TRANSITIONS[from].join(", ")}.`,
    );
  }
}
