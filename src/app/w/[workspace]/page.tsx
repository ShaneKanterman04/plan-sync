"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Message, Plan } from "@/lib/types";
import { api } from "@/components/api";
import { ActionBar } from "@/components/ActionBar";
import { ChangesRequestedModal } from "@/components/ChangesRequestedModal";
import { MessageThread } from "@/components/MessageThread";
import { PlanView } from "@/components/PlanView";
import { StatusBadge } from "@/components/StatusBadge";

export default function WorkspacePage() {
  const params = useParams<{ workspace: string }>();
  const workspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const path = `/api/w/${encodeURIComponent(workspace)}`;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
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

  const sourceRef = useRef<EventSource | null>(null);
  useEffect(() => {
    load();
    // Real-time push: refetch whenever a write route broadcasts a 'changed'
    // event over SSE, instead of polling every 5s.
    const source = new EventSource(`${path}/events`);
    sourceRef.current = source;
    source.addEventListener("changed", () => load());
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      source.close();
      sourceRef.current = null;
      window.removeEventListener("focus", onFocus);
    };
  }, [load, path]);

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
    if (!plan) return;
    setDraft(plan.bodyMd);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function saveEdit() {
    return act(async () => {
      await api(path, {
        method: "PUT",
        body: JSON.stringify({ author: "human", bodyMd: draft }),
      });
      setEditing(false);
    });
  }

  function approve() {
    return act(async () => {
      await api(`${path}/status`, {
        method: "PATCH",
        body: JSON.stringify({ author: "human", status: "approved" }),
      });
    });
  }

  function submitChangesRequested(note: string) {
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

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {plan ? (
        <>
          <PlanView editing={editing} body={plan.bodyMd} draft={draft} onDraftChange={setDraft} />
          {!editing && <MessageThread messages={messages} onSend={sendMessage} />}
        </>
      ) : (
        <p className="text-sm text-gray-400">Loading…</p>
      )}

      {plan && (
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
