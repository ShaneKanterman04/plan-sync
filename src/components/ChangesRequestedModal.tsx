"use client";

import { useEffect, useRef, useState } from "react";

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the draft and autofocus the textarea each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setNote("");
      textareaRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      open
      aria-label="Request changes"
      className="fixed inset-0 z-30 m-0 flex h-full max-h-full w-full max-w-full items-end justify-center bg-gray-900/40 p-4 backdrop-blur sm:items-center"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
        <h2 className="text-base font-extrabold text-gray-900">Request changes</h2>
        <p className="mt-0.5 text-sm text-gray-500">
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
          rows={4}
          className="mt-3 min-h-24 w-full resize-y rounded-xl border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-gray-500"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="min-h-12 flex-1 rounded-xl border border-gray-300 bg-white px-4 text-base font-bold text-gray-700 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(note.trim())}
            disabled={busy}
            className="min-h-12 flex-1 rounded-xl border border-rose-300 bg-rose-50 px-4 text-base font-bold text-rose-700 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </dialog>
  );
}
