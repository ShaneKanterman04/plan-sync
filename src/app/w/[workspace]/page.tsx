"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  DOCUMENT_TYPES,
  WORKSPACE_FILE_ROLES,
  type DocumentType,
  type Message,
  type Plan,
  type WorkspaceFile,
  type WorkspaceFileRole,
} from "@/lib/types";
import { api, timeLabel } from "@/components/api";
import { ActionBar } from "@/components/ActionBar";
import { ChangesRequestedModal } from "@/components/ChangesRequestedModal";
import { DocumentTypeBadge } from "@/components/DocumentTypeBadge";
import { LoadError } from "@/components/LoadError";
import { MessageThread } from "@/components/MessageThread";
import { PlanView } from "@/components/PlanView";
import { StaleWarning } from "@/components/StaleWarning";
import { StatusBadge } from "@/components/StatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLastSeen } from "@/components/useLastSeen";
import { useLiveReload } from "@/components/useLiveReload";

function staleReasons(plan: Plan): string[] {
  if (!["approved", "implementing", "done"].includes(plan.status)) return [];
  const reasons: string[] = [];
  if (plan.approvedVersion !== null && plan.version > plan.approvedVersion) {
    reasons.push(`Plan changed after approval: v${plan.approvedVersion} -> v${plan.version}`);
  }
  if (plan.approvedSha && plan.sourceSha && plan.approvedSha !== plan.sourceSha) {
    reasons.push(`Git SHA changed after approval: ${plan.approvedSha} -> ${plan.sourceSha}`);
  }
  if (plan.approvedBranch && plan.sourceBranch && plan.approvedBranch !== plan.sourceBranch) {
    reasons.push(
      `Git branch changed after approval: ${plan.approvedBranch} -> ${plan.sourceBranch}`,
    );
  }
  return reasons;
}

function filesForPlan(plan: Plan): WorkspaceFile[] {
  if (plan.files.length) return plan.files;
  const files: WorkspaceFile[] = [];
  if (plan.linkedFile) files.push({ path: plan.linkedFile, role: "sync" });
  for (const path of plan.referencedFiles) files.push({ path, role: "reference" });
  return files;
}

export default function WorkspacePage() {
  const params = useParams<{ workspace: string }>();
  const searchParams = useSearchParams();
  const workspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const path = `/api/w/${encodeURIComponent(workspace)}`;
  const readOnly = searchParams.get("readonly") === "1";

  const [plan, setPlan] = useState<Plan | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftDocumentType, setDraftDocumentType] = useState<DocumentType>("plan");
  const [draftFiles, setDraftFiles] = useState<WorkspaceFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showChangesModal, setShowChangesModal] = useState(false);

  const { firstUnreadAfter, markSeen } = useLastSeen(workspace);

  // Avoid clobbering the textarea with poll results while the human edits.
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  // The "new messages" divider anchors to the last-seen timestamp from the
  // PREVIOUS visit (null on a first-ever view). MessageThread flags messages
  // whose createdAt is strictly after this.
  //
  // We must SNAPSHOT this once on mount: useLastSeen hydrates stored.at
  // synchronously on the first render, but load() calls markSeen() on every
  // fetch, which advances stored.at (= firstUnreadAfter) to the NEWEST message's
  // timestamp. Reading it live would mean the very render that first paints the
  // thread already sees the cursor at "newest", so no message is strictly after
  // it and the divider never appears. Latching the pre-load value in a ref keeps
  // the divider anchored to where the human last left off, independent of how
  // many times markSeen runs afterward.
  const visitAnchorRef = useRef<string | null>(firstUnreadAfter);
  const firstUnreadAt = visitAnchorRef.current;

  const load = useCallback(async () => {
    try {
      const data = await api<{ plan: Plan; messages: Message[] }>(path);
      setMessages(data.messages);
      if (!editingRef.current) setPlan(data.plan);
      markSeen({
        lastMessageAt: data.messages.at(-1)?.createdAt ?? null,
        messageCount: data.messages.length,
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [path, markSeen]);

  const connectionError = useLiveReload({
    url: `${path}/events`,
    load,
    disconnectMessage: `Live updates disconnected from ${path}/events.`,
  });

  // Re-mark seen when the tab regains focus so the unread badge clears once the
  // human returns to a thread they were already viewing.
  useEffect(() => {
    function onFocus() {
      markSeen({
        lastMessageAt: messages.at(-1)?.createdAt ?? null,
        messageCount: messages.length,
      });
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [markSeen, messages]);

  async function onReact(messageId: string, emoji: string) {
    if (readOnly) return;
    await api(`${path}/reactions`, {
      method: "POST",
      body: JSON.stringify({ author: "human", messageId, emoji }),
    });
    await load();
  }

  // Keyboard shortcuts: E = edit, A = approve, R = request changes. Deliberately
  // inert while the human is typing (input/textarea/select/contentEditable), when
  // a modifier is held (so browser/OS chords pass through), in read-only mode,
  // while already editing, or while the request-changes modal is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (readOnly || editing || showChangesModal) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const key = event.key.toLowerCase();
      if (key === "e") {
        event.preventDefault();
        startEdit();
      } else if (key === "a") {
        event.preventDefault();
        void approve();
      } else if (key === "r") {
        event.preventDefault();
        setShowChangesModal(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // startEdit/approve are stable function declarations; gate on the guard state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, editing, showChangesModal, plan]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    if (!plan || readOnly) return;
    setDraft(plan.bodyMd);
    setDraftDocumentType(plan.documentType);
    setDraftFiles(filesForPlan(plan));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function saveEdit() {
    return act(async () => {
      await api(path, {
        method: "PUT",
        body: JSON.stringify({
          author: "human",
          bodyMd: draft,
          documentType: draftDocumentType,
          files: draftFiles.filter((file) => file.path.trim()),
        }),
      });
      setEditing(false);
    });
  }

  function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0 || readOnly) return;
    return act(async () => {
      const formData = new FormData();
      for (const file of selectedFiles) formData.append("files", file);
      const res = await fetch(`${path}/uploads`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Upload failed.");
    });
  }

  function updateDraftFile(index: number, patch: Partial<WorkspaceFile>) {
    setDraftFiles((current) =>
      current.map((file, i) => {
        if (i !== index) {
          if (patch.role === "sync" && file.role === "sync") return { ...file, role: "reference" };
          return file;
        }
        return { ...file, ...patch };
      }),
    );
  }

  function addDraftFile(role: WorkspaceFileRole) {
    setDraftFiles((current) => [
      ...current.map((file) =>
        role === "sync" && file.role === "sync" ? { ...file, role: "reference" as const } : file,
      ),
      { path: "", role },
    ]);
  }

  function removeDraftFile(index: number) {
    setDraftFiles((current) => current.filter((_, i) => i !== index));
  }

  function approve() {
    if (readOnly) return;
    return act(async () => {
      await api(`${path}/status`, {
        method: "PATCH",
        body: JSON.stringify({ author: "human", status: "approved" }),
      });
    });
  }

  function submitChangesRequested(note: string) {
    if (readOnly) return;
    setShowChangesModal(false);
    return act(async () => {
      await api(`${path}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          author: "human",
          status: "changes_requested",
          note: note || undefined,
        }),
      });
    });
  }

  async function sendMessage(body: string) {
    if (readOnly) return;
    setBusy(true);
    setError("");
    try {
      await api(`${path}/messages`, {
        method: "POST",
        body: JSON.stringify({ author: "human", body }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send.");
      // Refresh so the thread reflects server state, then re-throw so
      // MessageThread keeps the draft text for retry.
      await load();
      throw e;
    } finally {
      setBusy(false);
    }
    await load();
  }

  const workspaceFiles = plan ? filesForPlan(plan) : [];
  const syncFile = workspaceFiles.find((file) => file.role === "sync");
  const referenceFiles = workspaceFiles.filter((file) => file.role === "reference");

  return (
    <main
      id="main"
      className="mx-auto min-h-[100dvh] max-w-2xl overflow-x-clip px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(9.5rem+env(safe-area-inset-bottom))]"
    >
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border-strong bg-surface/90 px-[max(1rem,env(safe-area-inset-left))] py-3 shadow-raised backdrop-blur">
        <nav aria-label="Back" className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-muted active:text-foreground"
          >
            ← all plans
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {plan && <StatusBadge status={plan.status} />}
          </div>
        </nav>
        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold leading-6">{workspace}</h1>
          {plan && (
            <span className="shrink-0 text-[0.8125rem] leading-[18px] text-muted">
              v{plan.version} · {plan.updatedBy}
            </span>
          )}
        </div>
        {plan?.title && <p className="mt-0.5 truncate text-sm text-muted">{plan.title}</p>}
      </header>

      {error && <LoadError message={error} url={path} onRetry={load} />}
      {connectionError && (
        <p
          role="status"
          className="mb-4 rounded-card border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
        >
          {connectionError} Refreshing on focus is still enabled.
        </p>
      )}
      {readOnly && (
        <p
          role="status"
          className="mb-4 rounded-card border border-info bg-info-subtle px-4 py-3 text-sm text-info-foreground"
        >
          Read-only review mode. Editing, approval, and messages are disabled.
        </p>
      )}

      {plan ? (
        <>
          <StaleWarning reasons={staleReasons(plan)} />
          <section className="mb-4 rounded-card border border-border bg-surface p-4 text-sm text-muted shadow-card">
            <div className="flex flex-wrap items-center gap-1.5">
              <DocumentTypeBadge type={plan.documentType} />
              {syncFile && (
                <span className="min-w-0 break-all font-medium text-foreground">{syncFile.path}</span>
              )}
              {workspaceFiles.length > 0 && (
                <span className="text-[0.8125rem] leading-[18px] text-muted">
                  {workspaceFiles.length} file{workspaceFiles.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <dl className="mt-3 grid gap-1.5 text-[0.8125rem] leading-[18px] text-muted">
              <div className="flex flex-wrap gap-x-1.5">
                <dt className="font-medium text-foreground">Updated</dt>
                <dd>{timeLabel(plan.updatedAt)}</dd>
              </div>
              {plan.sourceBranch && (
                <div className="flex flex-wrap gap-x-1.5">
                  <dt className="font-medium text-foreground">Branch</dt>
                  <dd className="min-w-0 break-all">{plan.sourceBranch}</dd>
                </div>
              )}
              {plan.sourceSha && (
                <div className="flex flex-wrap gap-x-1.5">
                  <dt className="font-medium text-foreground">SHA</dt>
                  <dd className="min-w-0 break-all">{plan.sourceSha}</dd>
                </div>
              )}
              {plan.approvedAt && (
                <div className="flex flex-wrap gap-x-1.5">
                  <dt className="font-medium text-foreground">Approved</dt>
                  <dd>{timeLabel(plan.approvedAt)}</dd>
                </div>
              )}
            </dl>
            {workspaceFiles.length > 0 && (
              <details className="group mt-3 border-t border-border pt-3">
                <summary className="flex min-h-11 list-none items-center gap-2 rounded-control text-sm font-semibold text-foreground active:bg-surface-2 [&::-webkit-details-marker]:hidden">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="size-3 shrink-0 text-muted transition-transform group-open:rotate-90"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 2.5 8 6l-4 3.5" />
                  </svg>
                  Workspace files ({workspaceFiles.length})
                </summary>
                <ul className="mt-2 space-y-1.5 pl-5 text-[0.8125rem] leading-[18px] text-muted">
                  {syncFile && <li className="min-w-0 break-all">sync: {syncFile.path}</li>}
                  {referenceFiles.map((file) => (
                    <li key={file.path} className="min-w-0 break-all">
                      reference: {file.path}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!readOnly && (
              <label
                className={`mt-4 flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface px-4 text-sm font-semibold text-foreground transition active:scale-[0.98] active:bg-surface-2 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-surface${
                  busy ? " pointer-events-none opacity-40" : ""
                }`}
              >
                {busy && <span aria-hidden="true" className="spinner" />}
                Upload files
                <input
                  type="file"
                  multiple
                  accept=".csv,.txt,.md,.json,.log,text/csv,text/plain,application/json,text/markdown"
                  onChange={uploadFiles}
                  disabled={busy}
                  className="sr-only"
                />
              </label>
            )}
          </section>
          {editing && (
            <section className="row-fade-in mb-4 grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card">
              <label className="grid gap-1.5 text-sm font-semibold text-foreground">
                Document type
                <select
                  aria-label="Document type"
                  value={draftDocumentType}
                  onChange={(event) => setDraftDocumentType(event.target.value as DocumentType)}
                  className="min-h-11 rounded-control border border-border-strong bg-surface px-2 text-base font-normal text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">Workspace files</span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => addDraftFile("sync")}
                      disabled={draftFiles.some((file) => file.role === "sync")}
                      className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground transition active:scale-[0.98] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
                    >
                      Add sync
                    </button>
                    <button
                      type="button"
                      onClick={() => addDraftFile("reference")}
                      className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground transition active:scale-[0.98] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      Add ref
                    </button>
                  </div>
                </div>
                {draftFiles.length === 0 && (
                  <p className="text-sm text-muted">No workspace files attached.</p>
                )}
                {draftFiles.map((file, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[6rem_1fr_auto] gap-2"
                  >
                    <select
                      aria-label={`File ${index + 1} role`}
                      value={file.role}
                      onChange={(event) =>
                        updateDraftFile(index, { role: event.target.value as WorkspaceFileRole })
                      }
                      className="min-h-11 rounded-control border border-border-strong bg-surface px-2 text-base text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                    >
                      {WORKSPACE_FILE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`File ${index + 1} path`}
                      value={file.path}
                      onChange={(event) => updateDraftFile(index, { path: event.target.value })}
                      placeholder="docs/reports/example.md"
                      className="min-h-11 min-w-0 rounded-control border border-border-strong bg-surface px-3 text-base text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface placeholder:text-muted"
                    />
                    <button
                      type="button"
                      onClick={() => removeDraftFile(index)}
                      className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground transition active:scale-[0.98] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <PlanView editing={editing} body={plan.bodyMd} draft={draft} onDraftChange={setDraft} />
          {!editing && (
            <MessageThread
              messages={messages}
              onSend={sendMessage}
              readOnly={readOnly}
              onReact={readOnly ? undefined : onReact}
              firstUnreadAt={firstUnreadAt}
            />
          )}
        </>
      ) : (
        <div aria-hidden="true" className="space-y-4">
          <div className="rounded-card border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center gap-2">
              <div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" />
              <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
            </div>
            <div className="mt-3 space-y-2">
              <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-36 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
          <div className="space-y-2 rounded-card border border-border bg-surface p-4 shadow-card">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-16 animate-pulse rounded-card border border-border bg-surface shadow-card" />
          <div className="h-16 animate-pulse rounded-card border border-l-2 border-accent border-accent-subtle bg-accent-subtle shadow-card" />
          <span className="sr-only">Loading…</span>
        </div>
      )}

      {plan && !readOnly && !editing && (
        <p className="mb-2 text-center text-[0.8125rem] leading-[18px] text-muted">
          Shortcuts:{" "}
          <kbd className="rounded bg-surface-2 px-1 font-mono text-foreground">E</kbd> edit ·{" "}
          <kbd className="rounded bg-surface-2 px-1 font-mono text-foreground">A</kbd> approve ·{" "}
          <kbd className="rounded bg-surface-2 px-1 font-mono text-foreground">R</kbd> request changes
        </p>
      )}

      {plan && !readOnly && (
        <ActionBar
          status={plan.status}
          editing={editing}
          busy={busy}
          onEdit={startEdit}
          onCancel={cancelEdit}
          onSave={saveEdit}
          onApprove={approve}
          onRequestChanges={() => setShowChangesModal(true)}
        />
      )}

      <ChangesRequestedModal
        isOpen={showChangesModal}
        busy={busy}
        onClose={() => setShowChangesModal(false)}
        onSubmit={submitChangesRequested}
      />
    </main>
  );
}
