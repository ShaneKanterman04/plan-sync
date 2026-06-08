"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, MessageKind } from "@/lib/types";
import { MESSAGE_KINDS } from "@/lib/types";
import { timeLabel } from "@/components/api";

export function MessageThread({
  messages,
  onSend,
  readOnly = false,
}: {
  messages: Message[];
  onSend: (body: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<MessageKind | "all">("all");
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const visibleMessages =
    kindFilter === "all" ? messages : messages.filter((message) => message.kind === kindFilter);

  // Scroll the newest message into view whenever a message is added — both when
  // the human sends one and when SSE/polling delivers an agent reply. Keyed on
  // the message count so a plain re-render with the same messages is a no-op.
  // Skip the FIRST run so opening a plan lands at the top (on the plan body),
  // not deep at the bottom of a long discussion; only auto-scroll for messages
  // that arrive after mount.
  // Respect reduced-motion: CSS cannot reach the scrollIntoView argument, so we
  // read the preference here. matchMedia is undefined in some environments
  // (e.g. jsdom), so guard it and fall back to a smooth scroll.
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    const prev = prevCount.current;
    prevCount.current = messages.length;
    // First non-empty render establishes the baseline without scrolling (so the
    // page opens on the plan body, not the bottom of a long thread). This is
    // also resilient to Strict Mode's double-invoked mount, since the second
    // invoke sees an unchanged count.
    if (prev === null || messages.length <= prev) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    lastMessageRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
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
    <section className="mt-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        Discussion
      </h2>
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="message-kind-filter" className="text-sm font-medium text-muted">
          Filter
        </label>
        <select
          id="message-kind-filter"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value as MessageKind | "all")}
          className="min-h-11 rounded-control border border-border-strong bg-surface px-2 text-base text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        >
          <option value="all">All messages</option>
          {MESSAGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="space-y-2"
      >
        {messages.length === 0 && (
          <p aria-live="polite" className="text-sm text-muted">
            No messages yet.
          </p>
        )}
        {messages.length > 0 && visibleMessages.length === 0 && (
          <p aria-live="polite" className="text-sm text-muted">
            No messages match this filter.
          </p>
        )}
        {visibleMessages.map((m, i) => {
          const isAgent = m.author === "agent";
          const isLast = i === visibleMessages.length - 1;
          return (
            <div
              key={m.id}
              ref={isLast ? lastMessageRef : undefined}
              className={`space-y-2 rounded-card px-3 py-2 text-base text-foreground shadow-card ${
                isLast ? "msg-enter " : ""
              }${
                isAgent
                  ? "border border-accent-subtle border-l-2 border-l-accent bg-accent-subtle"
                  : "border border-border bg-surface"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isAgent
                        ? "bg-accent-subtle text-accent-subtle-foreground"
                        : "bg-surface-2 text-muted"
                    }`}
                  >
                    {isAgent ? "A" : "Y"}
                  </span>
                  <span className="truncate">{isAgent ? "Agent" : "You"}</span>
                  {m.kind !== "note" && (
                    <span className="font-medium text-faint">
                      · {m.kind.replace(/_/g, " ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted">{timeLabel(m.createdAt)}</span>
              </div>
              <div className="whitespace-pre-wrap break-words text-foreground">{m.body}</div>
            </div>
          );
        })}
      </div>
      {readOnly && (
        <p className="mt-4 rounded-card bg-surface-2 px-3 py-2 text-sm text-muted">
          Read-only review mode is enabled.
        </p>
      )}
      {!readOnly && (
        <div className="mt-4 flex gap-2">
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
            aria-label="Reply to the agent"
            rows={2}
            className="min-h-12 flex-1 resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface placeholder:text-muted"
          />
          <button
            onClick={send}
            disabled={busy || !body.trim()}
            aria-busy={busy}
            className="min-h-12 self-stretch rounded-control bg-primary px-4 text-base font-semibold text-primary-foreground transition active:scale-[0.98] active:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent"
                />
                Sending…
              </span>
            ) : (
              "Send"
            )}
          </button>
        </div>
      )}
    </section>
  );
}
