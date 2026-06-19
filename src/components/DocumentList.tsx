import Link from "next/link";
import { FileText, History, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DocumentSummary, DocumentType } from "@/lib/types";
import { relativeTime } from "@/components/api";
import { DocumentTypeBadge } from "@/components/DocumentTypeBadge";
import { StatusBadge } from "@/components/StatusBadge";

const ICONS: Record<DocumentType, LucideIcon> = {
  plan: ScrollText,
  summary: FileText,
  retrospective: History,
};

/**
 * Compact, phone-first document switcher. Renders a tappable list of all
 * documents in the workspace (primary plan first, then extra docs). The active
 * document is highlighted with the emerald accent and a left rule.
 *
 * Routing:
 *   - primary plan row → /w/[workspace]
 *   - extra-doc row    → /w/[workspace]/d/[slug]
 */
export function DocumentList({
  workspace,
  documents,
  currentDocId,
}: {
  workspace: string;
  documents: DocumentSummary[];
  /** docId of the currently-viewed document ("primary" on the plan page). */
  currentDocId: string;
}) {
  if (documents.length === 0) return null;

  return (
    <nav aria-label="Documents" className="mb-4">
      <h2 className="sr-only">Documents</h2>
      <ul className="overflow-hidden divide-y divide-border rounded-card border border-border bg-surface shadow-card">
        {documents.map((doc) => {
          const isCurrent = doc.docId === currentDocId;
          const href = doc.isPrimary
            ? `/w/${encodeURIComponent(workspace)}`
            : `/w/${encodeURIComponent(workspace)}/d/${encodeURIComponent(doc.slug)}`;
          const Icon: LucideIcon = ICONS[doc.documentType] ?? FileText;

          return (
            <li key={doc.docId}>
              <Link
                href={href}
                aria-current={isCurrent ? "page" : undefined}
                className={`relative flex min-h-12 items-start gap-3 px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface${
                  isCurrent
                    ? " bg-accent-subtle"
                    : " active:bg-surface-2"
                }`}
              >
                {/* Left accent rule for the active item */}
                {isCurrent && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-accent"
                  />
                )}

                {/* Document type icon */}
                <Icon
                  aria-hidden={true}
                  className={`mt-0.5 size-4 shrink-0 ${
                    isCurrent ? "text-accent" : "text-muted"
                  }`}
                />

                {/* Row body */}
                <div className="min-w-0 flex-1">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`min-w-0 flex-1 truncate text-sm font-semibold leading-5 ${
                        isCurrent ? "text-accent" : "text-foreground"
                      }`}
                    >
                      {doc.title}
                      {/* Unread dot affordance */}
                      {doc.messageCount > 0 && (
                        <span
                          aria-label={`${doc.messageCount} message${doc.messageCount === 1 ? "" : "s"}`}
                          className="ml-1 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-accent align-middle"
                        />
                      )}
                    </span>
                    {/* Badges — pointer-events-none so they don't eat the tap */}
                    <div className="pointer-events-none flex shrink-0 items-center gap-1.5">
                      <DocumentTypeBadge type={doc.documentType} />
                      {doc.isPrimary && doc.status && (
                        <StatusBadge status={doc.status} />
                      )}
                    </div>
                  </div>

                  {/* Meta line: vN · relative time · msg count */}
                  <p className="mt-0.5 text-[0.75rem] leading-4 text-muted">
                    v{doc.version}
                    {doc.updatedAt ? ` · ${relativeTime(doc.updatedAt)}` : ""}
                    {doc.messageCount > 0
                      ? ` · ${doc.messageCount} msg`
                      : ""}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
