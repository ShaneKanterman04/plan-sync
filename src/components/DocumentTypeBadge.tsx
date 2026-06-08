import type { DocumentType } from "@/lib/types";

const LABELS: Record<DocumentType, string> = {
  plan: "Plan",
  summary: "Summary",
  retrospective: "Retrospective",
};

export function DocumentTypeBadge({ type }: { type: DocumentType }) {
  return (
    <span
      title={LABELS[type]}
      className="inline-flex items-center whitespace-nowrap rounded-full border border-(--color-doctype-fg)/40 bg-transparent px-2.5 py-1 text-xs font-semibold text-(--color-doctype-fg) transition-colors"
    >
      {LABELS[type]}
    </span>
  );
}
