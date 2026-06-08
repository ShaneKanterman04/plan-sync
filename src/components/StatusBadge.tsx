import type { Status } from "@/lib/types";

const STYLES: Record<Status, string> = {
  draft: "bg-(--color-st-draft-bg) text-(--color-st-draft-fg)",
  review: "bg-(--color-st-review-bg) text-(--color-st-review-fg)",
  changes_requested: "bg-(--color-st-changes-bg) text-(--color-st-changes-fg)",
  approved: "bg-(--color-st-approved-bg) text-(--color-st-approved-fg)",
  implementing: "bg-(--color-st-impl-bg) text-(--color-st-impl-fg)",
  done: "bg-(--color-st-done-bg) text-(--color-st-done-fg)",
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
      title={LABELS[status]}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
