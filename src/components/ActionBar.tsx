"use client";

import type { Status } from "@/lib/types";

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
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        {editing ? (
          <>
            <button
              onClick={onCancel}
              disabled={busy}
              className="min-h-12 flex-1 rounded-xl border border-gray-300 bg-white px-4 text-base font-bold text-gray-700 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={busy}
              className="min-h-12 flex-1 rounded-xl bg-gray-900 px-4 text-base font-bold text-white disabled:opacity-40"
            >
              Save edits
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              disabled={busy}
              className="min-h-12 rounded-xl border border-gray-300 bg-white px-4 text-base font-bold text-gray-700 disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={onRequestChanges}
              disabled={busy}
              className="min-h-12 flex-1 rounded-xl border border-rose-300 bg-rose-50 px-3 text-base font-bold text-rose-700 disabled:opacity-40"
            >
              Request changes
            </button>
            <button
              onClick={onApprove}
              disabled={busy}
              className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white disabled:opacity-40"
            >
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}
