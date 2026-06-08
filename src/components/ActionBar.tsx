"use client";

import { useState } from "react";
import type { Status } from "@/lib/types";

type PendingAction = "save" | "approve" | "request" | null;

function Spinner() {
  return <span aria-hidden="true" className="spinner mr-2 inline-block align-[-0.125em]" />;
}

export function ActionBar({
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
  onApprove,
  onRequestChanges,
}: {
  status: Status;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  // Track which action the user tapped so only that button shows the busy
  // label/spinner; the others simply disable. When not busy, `active` is null
  // regardless of the last-tapped value, so no stale reset is needed.
  const [pending, setPending] = useState<PendingAction>(null);
  const active = busy ? pending : null;

  const secondary =
    "min-h-11 rounded-control border border-border-strong bg-surface px-4 text-base font-semibold text-foreground transition active:scale-[0.98] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40";
  const primary =
    "min-h-12 rounded-control bg-primary px-4 text-base font-semibold text-primary-foreground transition active:scale-[0.98] active:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40";
  const danger =
    "min-h-12 rounded-control border border-danger bg-danger-subtle px-3 text-base font-semibold text-danger-foreground transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 whitespace-nowrap";
  const success =
    "min-h-12 rounded-control bg-success px-4 text-base font-semibold text-success-foreground transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40";

  return (
    <div
      role="region"
      aria-label="Plan actions"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border-strong bg-surface/90 shadow-raised backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-2xl gap-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-3">
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onCancel} disabled={busy} className={secondary}>
              Cancel
            </button>
            <button
              onClick={() => {
                setPending("save");
                onSave();
              }}
              disabled={busy}
              aria-busy={active === "save"}
              className={primary}
            >
              {active === "save" ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                "Save edits"
              )}
            </button>
          </div>
        ) : (
          <>
            <button onClick={onEdit} disabled={busy} className={`${secondary} w-full`}>
              Edit
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setPending("request");
                  onRequestChanges();
                }}
                disabled={busy}
                aria-busy={active === "request"}
                className={danger}
              >
                Request changes
              </button>
              <button
                onClick={() => {
                  setPending("approve");
                  onApprove();
                }}
                disabled={busy}
                aria-busy={active === "approve"}
                className={success}
              >
                {active === "approve" ? (
                  <>
                    <Spinner />
                    Approving…
                  </>
                ) : (
                  "Approve"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
