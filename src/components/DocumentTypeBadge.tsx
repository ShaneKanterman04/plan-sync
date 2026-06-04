import type { DocumentType } from "@/lib/types";

const LABELS: Record<DocumentType, string> = {
  plan: "Plan",
  summary: "Summary",
  retrospective: "Retrospective",
};

const STYLES: Record<DocumentType, string> = {
  plan: "bg-slate-100 text-slate-700",
  summary: "bg-cyan-100 text-cyan-800",
  retrospective: "bg-fuchsia-100 text-fuchsia-800",
};

export function DocumentTypeBadge({ type }: { type: DocumentType }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STYLES[type]}`}>
      {LABELS[type]}
    </span>
  );
}
