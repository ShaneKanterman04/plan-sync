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

  // Avoid clobbering the textarea with poll results while the human edits.
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const load = useCallback(async () => {
    try {
      const data = await api<{ plan: Plan; messages: Message[] }>(path);
      setMessages(data.messages);
      if (!editingRef.current) setPlan(data.plan);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [path]);

  const connectionError = useLiveReload({
    url: `${path}/events`,
    load,
    disconnectMessage: `Live updates disconnected from ${path}/events.`,
  });

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
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28">
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="text-sm text-gray-500">
            ← all plans
          </Link>
          {plan && <StatusBadge status={plan.status} />}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-extrabold">{workspace}</h1>
          {plan && (
            <span className="text-xs text-gray-400">
              v{plan.version} · {plan.updatedBy}
            </span>
          )}
        </div>
        {plan?.title && <p className="text-sm text-gray-600">{plan.title}</p>}
      </header>

      {error && <LoadError message={error} url={path} onRetry={load} />}
      {connectionError && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {connectionError} Refreshing on focus is still enabled.
        </p>
      )}
      {readOnly && (
        <p className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Read-only review mode. Editing, approval, and messages are disabled.
        </p>
      )}

      {plan ? (
        <>
          <StaleWarning reasons={staleReasons(plan)} />
          <section className="mb-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
            <div className="flex flex-wrap items-center gap-2">
              <DocumentTypeBadge type={plan.documentType} />
              {syncFile && <span className="break-all">{syncFile.path}</span>}
              {workspaceFiles.length > 0 && (
                <span className="text-xs text-gray-400">
                  {workspaceFiles.length} file{workspaceFiles.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="mt-2 grid gap-1 text-xs text-gray-400">
              <span>Updated {timeLabel(plan.updatedAt)}</span>
              {plan.sourceBranch && <span>Branch {plan.sourceBranch}</span>}
              {plan.sourceSha && <span>SHA {plan.sourceSha}</span>}
              {plan.approvedAt && <span>Approved {timeLabel(plan.approvedAt)}</span>}
            </div>
            {workspaceFiles.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-bold text-gray-500">
                  Workspace files ({workspaceFiles.length})
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                  {syncFile && (
                    <li className="break-all">
                      sync: {syncFile.path}
                    </li>
                  )}
                  {referenceFiles.map((file) => (
                    <li key={file.path} className="break-all">
                      reference: {file.path}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          {editing && (
            <section className="mb-3 grid gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3">
              <label className="grid gap-1 text-sm font-bold text-gray-700">
                Document type
                <select
                  value={draftDocumentType}
                  onChange={(event) => setDraftDocumentType(event.target.value as DocumentType)}
                  className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base font-normal outline-none focus:border-gray-500"
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-gray-700">Workspace files</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => addDraftFile("sync")}
                      disabled={draftFiles.some((file) => file.role === "sync")}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-bold text-gray-700 disabled:opacity-40"
                    >
                      Add sync
                    </button>
                    <button
                      type="button"
                      onClick={() => addDraftFile("reference")}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-bold text-gray-700"
                    >
                      Add ref
                    </button>
                  </div>
                </div>
                {draftFiles.length === 0 && (
                  <p className="text-xs text-gray-400">No workspace files attached.</p>
                )}
                {draftFiles.map((file, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_1fr_auto]">
                    <select
                      value={file.role}
                      onChange={(event) =>
                        updateDraftFile(index, { role: event.target.value as WorkspaceFileRole })
                      }
                      className="min-h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm outline-none focus:border-gray-500"
                    >
                      {WORKSPACE_FILE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <input
                      value={file.path}
                      onChange={(event) => updateDraftFile(index, { path: event.target.value })}
                      placeholder="docs/reports/example.md"
                      className="min-h-11 min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-base outline-none focus:border-gray-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeDraftFile(index)}
                      className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm font-bold text-gray-700"
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
            <MessageThread messages={messages} onSend={sendMessage} readOnly={readOnly} />
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400">Loading…</p>
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
