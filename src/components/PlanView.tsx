"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";

type EditMode = "write" | "preview";

const MODES: { value: EditMode; label: string }[] = [
  { value: "write", label: "Write" },
  { value: "preview", label: "Preview" },
];

export function PlanView({
  editing,
  body,
  draft,
  onDraftChange,
}: {
  editing: boolean;
  body: string;
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  // Write|Preview toggle is edit-mode only; the read view (editing === false)
  // is unchanged. Default to "write" so the editor opens on the textarea.
  const [mode, setMode] = useState<EditMode>("write");

  if (editing) {
    return (
      <div key="plan-editor" className="msg-enter flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Editor mode"
          className="inline-flex items-center gap-1 self-start rounded-control border border-border bg-surface p-1 shadow-card"
        >
          {MODES.map((opt) => {
            const selected = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMode(opt.value)}
                className={
                  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
                  (selected
                    ? "bg-accent-subtle text-accent-subtle-foreground"
                    : "bg-transparent text-muted hover:text-foreground active:bg-surface-2")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {mode === "write" ? (
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onFocus={(e) =>
              // Keep the caret visible above the keyboard when the editor opens.
              e.currentTarget.scrollIntoView({ block: "nearest" })
            }
            placeholder="Write the plan in markdown…"
            aria-label="Plan markdown"
            className="min-h-[50dvh] w-full resize-y rounded-control border border-border-strong bg-surface p-4 font-mono text-base leading-relaxed text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface placeholder:text-muted"
          />
        ) : (
          <div className="min-h-[50dvh] w-full rounded-control border border-border bg-surface p-4">
            <Markdown>{draft}</Markdown>
          </div>
        )}
      </div>
    );
  }
  return (
    <div key="plan-view" className="msg-enter">
      <Markdown>{body}</Markdown>
    </div>
  );
}
