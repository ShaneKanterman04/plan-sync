"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type {
  AgentActivity as AgentActivityData,
  Document,
  DocumentSummary,
  Message,
} from "@/lib/types";
import { api, timeLabel } from "@/components/api";
import { AgentActivity } from "@/components/AgentActivity";
import { DocumentList } from "@/components/DocumentList";
import { DocumentTypeBadge } from "@/components/DocumentTypeBadge";
import { LoadError } from "@/components/LoadError";
import { Markdown } from "@/components/Markdown";
import { MessageThread } from "@/components/MessageThread";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLastSeen } from "@/components/useLastSeen";
import { useLiveReload } from "@/components/useLiveReload";

export default function DocPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string; doc: string }>();
  const workspace = Array.isArray(params.workspace)
    ? params.workspace[0]
    : params.workspace;
  const doc = Array.isArray(params.doc) ? params.doc[0] : params.doc;

  const docPath = `/api/w/${encodeURIComponent(workspace)}/d/${encodeURIComponent(doc)}`;
  // Documents share the workspace-level SSE stream; no dedicated doc events route.
  const eventsPath = `/api/w/${encodeURIComponent(workspace)}/events`;
  const overviewPath = `/api/w/${encodeURIComponent(workspace)}/documents`;
  const workspacePath = `/w/${encodeURIComponent(workspace)}`;

  const [document, setDocument] = useState<Document | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [agentActivity, setAgentActivity] = useState<AgentActivityData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // Key the last-seen tracker under "workspace/d/doc" to avoid colliding with
  // the workspace-level unread cursor (which uses just "workspace").
  const { firstUnreadAfter, markSeen } = useLastSeen(`${workspace}/d/${doc}`);

  // Snapshot the divider anchor at mount time. useState captures the initial
  // value and never updates it (no setter called), giving the same
  // "freeze on first render" semantics — without reading a ref during render.
  const [firstUnreadAt] = useState<string | null>(firstUnreadAfter);

  const load = useCallback(async () => {
    try {
      const data = await api<{ document: Document; messages: Message[] }>(docPath);
      setDocument(data.document);
      setMessages(data.messages);
      markSeen({
        lastMessageAt: data.messages.at(-1)?.createdAt ?? null,
        messageCount: data.messages.length,
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
    // The sidebar switcher + agent-activity are best-effort: a failure here must
    // not block reading the document itself, so it never sets the error banner.
    try {
      const overview = await api<{
        documents: DocumentSummary[];
        agentActivity: AgentActivityData;
      }>(overviewPath);
      setDocuments(overview.documents);
      setAgentActivity(overview.agentActivity);
    } catch {
      // ignore — keep whatever sidebar data we already have.
    }
  }, [docPath, overviewPath, markSeen]);

  const connectionError = useLiveReload({
    url: eventsPath,
    load,
    disconnectMessage: `Live updates disconnected from ${eventsPath}.`,
  });

  // Re-mark seen when the tab regains focus so the unread marker clears.
  // (Mirrors the workspace page's focus handler.)
  //
  // Note: this `useEffect` call is intentionally omitted to keep the diff
  // minimal — the useLiveReload hook already registers a focus → load() handler,
  // which will call markSeen via load().

  async function sendMessage(body: string) {
    setBusy(true);
    setError("");
    try {
      await api(`${docPath}/messages`, {
        method: "POST",
        body: JSON.stringify({ author: "human", body }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send.");
      await load();
      throw e;
    } finally {
      setBusy(false);
    }
    await load();
  }

  async function handleArchive() {
    if (!document) return;
    setArchiveBusy(true);
    setError("");
    try {
      const data = await api<{ document: Document }>(docPath, {
        method: "PATCH",
        body: JSON.stringify({ author: "human", archived: !document.archived }),
      });
      setDocument(data.document);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive.");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        "Delete this document and its thread? This cannot be undone.",
      )
    )
      return;
    setError("");
    try {
      await api(docPath, { method: "DELETE" });
      router.push(workspacePath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete.");
    }
  }

  const iconBtn =
    "rounded-control p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40";

  return (
    <main
      id="main"
      className="mx-auto min-h-[100dvh] max-w-2xl overflow-x-clip px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-10 lg:max-w-6xl"
    >
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border-strong bg-surface/90 px-[max(1rem,env(safe-area-inset-left))] py-3 shadow-raised backdrop-blur">
        <nav aria-label="Back" className="flex items-center justify-between gap-2">
          <Link
            href={workspacePath}
            className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-muted active:text-foreground"
          >
            ← {workspace}
          </Link>
          <ThemeToggle />
        </nav>
        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold leading-6">
            {document?.title ?? doc}
          </h1>
          {document && (
            <span className="shrink-0 text-[0.8125rem] leading-[18px] text-muted">
              v{document.version} · {document.updatedBy}
            </span>
          )}
        </div>
        {document && (
          <div className="mt-0.5 flex items-center justify-between gap-1.5">
            {/* Left: type badge + archived indicator */}
            <div className="flex items-center gap-1.5">
              <DocumentTypeBadge type={document.documentType} />
              {document.archived && (
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-warning-subtle px-2.5 py-1 text-xs font-semibold text-warning-foreground">
                  Archived
                </span>
              )}
            </div>
            {/* Right: archive + delete icon actions */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleArchive}
                disabled={archiveBusy}
                title={document.archived ? "Unarchive" : "Archive"}
                aria-label={
                  document.archived ? "Unarchive document" : "Archive document"
                }
                className={`${iconBtn} text-muted hover:bg-surface-2 active:bg-surface-2`}
              >
                {document.archived ? (
                  <ArchiveRestore className="size-4" aria-hidden />
                ) : (
                  <Archive className="size-4" aria-hidden />
                )}
              </button>
              <button
                onClick={handleDelete}
                title="Delete document"
                aria-label="Delete document"
                className={`${iconBtn} text-danger-foreground hover:bg-danger-subtle active:bg-danger-subtle`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </header>

      {error && <LoadError message={error} url={docPath} onRetry={load} />}
      {connectionError && (
        <p
          role="status"
          className="mb-4 rounded-card border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
        >
          {connectionError} Refreshing on focus is still enabled.
        </p>
      )}

      <div className="lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <aside className="mb-4 space-y-4 lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1">
          {agentActivity && <AgentActivity variant="card" activity={agentActivity} />}
          <DocumentList workspace={workspace} documents={documents} currentDocId={doc} />
        </aside>

        <div className="min-w-0">
          {document ? (
            <>
              {/* Document metadata card */}
              <section className="mb-4 rounded-card border border-border bg-surface p-4 text-sm text-muted shadow-card">
                <dl className="grid gap-1.5 text-[0.8125rem] leading-[18px]">
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-medium text-foreground">Updated</dt>
                    <dd>{timeLabel(document.updatedAt)}</dd>
                  </div>
                </dl>
              </section>

              {/* Document body */}
              <section className="mb-4 rounded-card border border-border bg-surface p-4 shadow-card">
                <Markdown>{document.bodyMd}</Markdown>
              </section>

              {/* Discussion thread */}
              <MessageThread
                messages={messages}
                onSend={sendMessage}
                firstUnreadAt={firstUnreadAt}
              />
            </>
          ) : (
            !error && (
              <div aria-hidden="true" className="space-y-4">
                <div className="rounded-card border border-border bg-surface p-4 shadow-card">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" />
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
                  </div>
                </div>
                <div className="space-y-2 rounded-card border border-border bg-surface p-4 shadow-card">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
                  <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2" />
                </div>
                <span className="sr-only">Loading…</span>
              </div>
            )
          )}
        </div>
      </div>

      {/* Suppress the busy indicator — MessageThread tracks its own send state */}
      {busy && <span className="sr-only" aria-live="polite">Sending…</span>}
    </main>
  );
}
