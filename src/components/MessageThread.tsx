"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, MessageKind } from "@/lib/types";
import { MESSAGE_KINDS, REACTION_EMOJIS } from "@/lib/types";
import { timeLabel } from "@/components/api";

export function MessageThread({
  messages,
  onSend,
  readOnly = false,
  onReact,
  firstUnreadAt = null,
}: {
  messages: Message[];
  onSend: (body: string) => Promise<void>;
  readOnly?: boolean;
  onReact?: (messageId: string, emoji: string) => Promise<void>;
  firstUnreadAt?: string | null;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<MessageKind | "all">("all");
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const visibleMessages =
    kindFilter === "all" ? messages : messages.filter((message) => message.kind === kindFilter);

  // Reaction chips + the add-reaction control only appear when a real handler is
  // wired and we are not in read-only review mode. Without onReact there is
  // nowhere for a toggle to go, so we hide the whole affordance.
  const canReact = !readOnly && typeof onReact === "function";

  // The unread divider sits before the first visible message that arrived after
  // the last time this viewer saw the thread. firstUnreadAt is the persisted
  // "last seen" timestamp (null === never seen / nothing to mark), supplied by
  // the page from useLastSeen.firstUnreadAfter.
  const firstUnreadIndex =
    firstUnreadAt == null
      ? -1
      : visibleMessages.findIndex((message) => message.createdAt > firstUnreadAt);

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
          const reactions = m.reactions ?? [];
          const reactedEmojis = new Set(reactions.map((r) => r.emoji));
          const showDivider = i === firstUnreadIndex;
          return (
            <div key={m.id} className="space-y-2">
              {showDivider && (
                <div
                  role="separator"
                  aria-label="New messages"
                  className="flex items-center gap-2 py-1 text-xs font-semibold uppercase tracking-wide text-accent"
                >
                  <span aria-hidden="true" className="h-px flex-1 bg-accent-subtle" />
                  <span>New</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-accent-subtle" />
                </div>
              )}
              <div
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
                {canReact && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        onClick={() => void onReact?.(m.id, r.emoji)}
                        aria-pressed={r.mine ? true : false}
                        aria-label={`${r.count} ${r.emoji} reaction${
                          r.count === 1 ? "" : "s"
                        }${r.mine ? ", including yours" : ""}`}
                        className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
                          r.mine
                            ? "border-accent bg-accent-subtle text-accent-subtle-foreground"
                            : "border-border bg-surface text-foreground hover:bg-surface-2"
                        }`}
                      >
                        <span aria-hidden="true">{r.emoji}</span>
                        <span aria-hidden="true">{r.count}</span>
                      </button>
                    ))}
                    <span
                      role="group"
                      aria-label="Add reaction"
                      className="inline-flex items-center gap-0.5"
                    >
                      {REACTION_EMOJIS.filter((emoji) => !reactedEmojis.has(emoji)).map(
                        (emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => void onReact?.(m.id, emoji)}
                            aria-label={`React with ${emoji}`}
                            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full border border-transparent px-1 text-sm text-muted transition hover:border-border hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                          >
                            <span aria-hidden="true">{emoji}</span>
                          </button>
                        ),
                      )}
                    </span>
                  </div>
                )}
              </div>
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
