"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, History, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DOCUMENT_TYPES, type DocumentSummary, type DocumentType } from "@/lib/types";
import { relativeTime } from "@/components/api";
import { StatusBadge } from "@/components/StatusBadge";

const ICONS: Record<DocumentType, LucideIcon> = {
  plan: ScrollText,
  summary: FileText,
  retrospective: History,
};

// Plural section headings — the heading carries the type, so rows omit a badge.
const SECTION_LABELS: Record<DocumentType, string> = {
  plan: "Plan",
  summary: "Summaries",
  retrospective: "Retrospectives",
};

// Above this many documents the list gets a search box, and large sections
// collapse by default so a busy workspace (e.g. a dozen summaries) stays tidy.
const SEARCH_THRESHOLD = 6;
const COLLAPSE_THRESHOLD = 6;

/**
 * Document switcher for a workspace, grouped into collapsible sections by type
 * (Plan / Summaries / Retrospectives). The active document is highlighted with
 * the accent and a left rule. Works as a phone-width block and as a desktop
 * sidebar rail.
 *
 * Decluttering: sections with many docs collapse by default (the section that
 * holds the current doc, and the Plan section, stay open). A search box appears
 * once a workspace has more than a handful of documents and force-opens any
 * section with a match.
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
  const [query, setQuery] = useState("");
  // Per-type explicit open/closed choices; absence means "use the default".
  const [overrides, setOverrides] = useState<Partial<Record<DocumentType, boolean>>>({});
  const sectionIdBase = useId();

  if (documents.length === 0) return null;

  const q = query.trim().toLowerCase();
  const matches = (d: DocumentSummary) =>
    !q || d.title.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q);
  const visible = documents.filter(matches);

  const showSearch = documents.length > SEARCH_THRESHOLD;

  return (
    <nav aria-label="Documents">
      <h2 className="sr-only">Documents</h2>

      {showSearch && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${documents.length} documents…`}
          aria-label="Search documents"
          className="mb-2 min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface placeholder:text-muted"
        />
      )}

      {visible.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">
          No documents match “{query.trim()}”.
        </p>
      ) : (
        <div className="space-y-2">
          {DOCUMENT_TYPES.map((type) => {
            const items = visible.filter((d) => d.documentType === type);
            if (items.length === 0) return null;

            const SectionIcon = ICONS[type];
            const hasCurrent = items.some((d) => d.docId === currentDocId);
            const defaultOpen =
              type === "plan" || hasCurrent || items.length <= COLLAPSE_THRESHOLD;
            // A search always force-opens matching sections so results are visible.
            const open = q ? true : overrides[type] ?? defaultOpen;
            const listId = `${sectionIdBase}-${type}`;

            return (
              <div
                key={type}
                className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() =>
                    setOverrides((current) => ({ ...current, [type]: !open }))
                  }
                  className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left transition active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <SectionIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                  <span className="text-sm font-semibold text-foreground">
                    {SECTION_LABELS[type]}
                  </span>
                  <span className="text-[0.8125rem] text-muted">({items.length})</span>
                </button>

                {open && (
                  <ul id={listId} className="divide-y divide-border border-t border-border">
                    {items.map((doc) => {
                      const isCurrent = doc.docId === currentDocId;
                      const href = doc.isPrimary
                        ? `/w/${encodeURIComponent(workspace)}`
                        : `/w/${encodeURIComponent(workspace)}/d/${encodeURIComponent(doc.slug)}`;

                      return (
                        <li key={doc.docId}>
                          <Link
                            href={href}
                            aria-current={isCurrent ? "page" : undefined}
                            className={`relative flex min-h-12 items-start gap-3 px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface${
                              isCurrent ? " bg-accent-subtle" : " active:bg-surface-2"
                            }`}
                          >
                            {isCurrent && (
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-accent"
                              />
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <span
                                  className={`min-w-0 flex-1 truncate text-sm font-semibold leading-5 ${
                                    isCurrent ? "text-accent" : "text-foreground"
                                  }`}
                                >
                                  {doc.title}
                                  {doc.messageCount > 0 && (
                                    <span
                                      aria-label={`${doc.messageCount} message${doc.messageCount === 1 ? "" : "s"}`}
                                      className="ml-1 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-accent align-middle"
                                    />
                                  )}
                                </span>
                                {doc.isPrimary && doc.status && (
                                  <span className="pointer-events-none shrink-0">
                                    <StatusBadge status={doc.status} />
                                  </span>
                                )}
                              </div>

                              <p className="mt-0.5 text-[0.75rem] leading-4 text-muted">
                                v{doc.version}
                                {doc.updatedAt ? ` · ${relativeTime(doc.updatedAt)}` : ""}
                                {` · ${doc.updatedBy}`}
                                {doc.messageCount > 0 ? ` · ${doc.messageCount} msg` : ""}
                              </p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
