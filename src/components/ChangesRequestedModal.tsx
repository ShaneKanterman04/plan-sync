"use client";

import { useEffect, useRef, useState } from "react";

function Spinner() {
  return <span aria-hidden="true" className="spinner mr-2 inline-block align-[-0.125em]" />;
}

export function ChangesRequestedModal({
  isOpen,
  busy,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Remember what was focused before the sheet opened so we can restore it on
  // close (the triggering "Request changes" button in the ActionBar).
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Promote to the top layer (real focus trap, ::backdrop, Esc-to-cancel) when
  // opening. jsdom does not implement showModal(); fall back to the `open`
  // attribute so the dialog role stays exposed in tests.
  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setNote("");
    const el = dialogRef.current;
    if (el && !el.open) {
      try {
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
    }
    textareaRef.current?.focus();

    // Lock background scroll while the sheet is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Request changes"
      onCancel={(e) => {
        // Native Esc / light-dismiss cancel -> route through the parent's
        // onClose (which unmounts the dialog) instead of the native close so
        // React stays the source of truth for the open state.
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-30 m-0 flex h-[100dvh] max-h-none w-full max-w-none items-end justify-center bg-transparent p-0 sm:items-center sm:p-4"
    >
      <div
        className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-t-card border border-border bg-surface-raised p-4 text-foreground shadow-overlay sm:rounded-card"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h2 className="text-lg font-bold text-foreground">Request changes</h2>
        <p className="mt-1 text-sm text-muted">
          Tell the agent what needs to change. This note is sent to the thread.
        </p>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
              e.preventDefault();
              onSubmit(note.trim());
            }
          }}
          placeholder="What changes are needed?"
          aria-label="Changes needed"
          rows={4}
          className="mt-3 min-h-24 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-foreground outline-none transition placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-control border border-border-strong bg-surface px-4 text-base font-semibold text-foreground transition active:scale-[0.98] active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(note.trim())}
            disabled={busy}
            aria-busy={busy}
            className="min-h-12 rounded-control border border-danger bg-danger-subtle px-3 text-base font-semibold text-danger-foreground transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 whitespace-nowrap"
          >
            {busy && <Spinner />}
            Send
          </button>
        </div>
      </div>
    </dialog>
  );
}
