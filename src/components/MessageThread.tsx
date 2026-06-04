"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";
import { relativeTime } from "@/components/api";

export function MessageThread({
  messages,
  onSend,
}: {
  messages: Message[];
  onSend: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  // Scroll the newest message into view whenever a message is added — both when
  // the human sends one and when SSE/polling delivers an agent reply. Keyed on
  // the message count so a plain re-render with the same messages is a no-op.
  useEffect(() => {
    if (messages.length === 0) return;
    lastMessageRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages.length]);

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSend(text);
      setBody("");
    } catch {
      // onSend surfaces the failure (error banner) and we keep the draft text
      // so the human can retry; swallow here so the click handler doesn't
      // produce an unhandled rejection.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
        Discussion
      </h2>
      <div className="space-y-2">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">No messages yet.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={m.id}
            ref={i === messages.length - 1 ? lastMessageRef : undefined}
            className={`rounded-xl border px-3 py-2 text-sm ${
              m.author === "agent"
                ? "border-blue-100 bg-blue-50"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-gray-700">
                {m.author === "agent" ? "🤖 Agent" : "🧑 You"}
                {m.kind !== "note" && (
                  <span className="ml-1 font-medium text-gray-400">
                    · {m.kind.replace(/_/g, " ")}
                  </span>
                )}
              </span>
              <span className="text-gray-400">{relativeTime(m.createdAt)}</span>
            </div>
            <div className="whitespace-pre-wrap text-gray-800">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Reply to the agent…"
          rows={2}
          className="min-h-12 flex-1 resize-y rounded-xl border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-gray-500"
        />
        <button
          onClick={send}
          disabled={busy || !body.trim()}
          className="min-h-12 self-stretch rounded-xl bg-gray-900 px-4 text-base font-bold text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </section>
  );
}
