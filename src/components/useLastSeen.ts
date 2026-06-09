"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal message-thread summary the caller already has from a workspace
 *  snapshot — no message bodies needed, just a count and the latest timestamp. */
export type SeenSummary = {
  lastMessageAt: string | null;
  messageCount: number;
};

/** Persisted shape under plansync:lastSeen:WORKSPACE. */
type StoredSeen = {
  at: string | null;
  count: number;
};

function storageKey(workspace: string): string {
  return `plansync:lastSeen:${workspace}`;
}

function readStored(workspace: string): StoredSeen | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(storageKey(workspace));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSeen>;
    const count = typeof parsed.count === "number" ? parsed.count : 0;
    const at = typeof parsed.at === "string" ? parsed.at : null;
    return { at, count };
  } catch {
    // Corrupt JSON / unavailable storage — treat as never-seen.
    return null;
  }
}

/**
 * Per-workspace "last seen" tracker for unread badges + the new-message
 * divider. Backed entirely by localStorage (key plansync:lastSeen:WORKSPACE,
 * JSON `{ at, count }`). Unread is count-based so it never depends on clock
 * skew between client and server.
 */
export function useLastSeen(workspace: string): {
  lastSeenAt: string | null;
  lastSeenCount: number;
  unreadCount: (s: SeenSummary) => number;
  firstUnreadAfter: string | null;
  markSeen: (i: SeenSummary) => void;
} {
  // Hydrate synchronously on the FIRST render via a lazy initializer so the
  // unread badge / divider never flash a wrong value (full messageCount) before
  // an effect patches localStorage in. readStored is SSR-safe (guards on
  // typeof localStorage) and swallows storage errors, returning null.
  const [stored, setStored] = useState<StoredSeen>(
    () => readStored(workspace) ?? { at: null, count: 0 },
  );

  // Re-read whenever the workspace changes so the hook stays scoped to the
  // right thread. Skips the initial mount, which the lazy initializer covered.
  const hydratedFor = useRef(workspace);
  useEffect(() => {
    if (hydratedFor.current === workspace) return;
    hydratedFor.current = workspace;
    setStored(readStored(workspace) ?? { at: null, count: 0 });
  }, [workspace]);

  const unreadCount = useCallback(
    (s: SeenSummary) => Math.max(0, s.messageCount - stored.count),
    [stored.count],
  );

  const markSeen = useCallback(
    (i: SeenSummary) => {
      const next: StoredSeen = { at: i.lastMessageAt, count: i.messageCount };
      setStored(next);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(storageKey(workspace), JSON.stringify(next));
        }
      } catch {
        // Best-effort persistence; in-memory state still updates the UI.
      }
    },
    [workspace],
  );

  return {
    lastSeenAt: stored.at,
    lastSeenCount: stored.count,
    unreadCount,
    // The divider anchors to the last-seen timestamp; null until first markSeen.
    firstUnreadAfter: stored.at,
    markSeen,
  };
}
