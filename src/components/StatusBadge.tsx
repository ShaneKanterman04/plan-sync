import type { Status } from "@/lib/types";

const STYLES: Record<Status, string> = {
  draft: "bg-gray-100 text-gray-700",
  review: "bg-amber-100 text-amber-800",
  changes_requested: "bg-rose-100 text-rose-800",
  approved: "bg-emerald-100 text-emerald-800",
  implementing: "bg-blue-100 text-blue-800",
  done: "bg-violet-100 text-violet-800",
};

const LABELS: Record<Status, string> = {
  draft: "Draft",
  review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  implementing: "Implementing",
  done: "Done",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
