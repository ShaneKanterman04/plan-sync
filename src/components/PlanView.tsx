"use client";

import { Markdown } from "@/components/Markdown";

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
  if (editing) {
    return (
      <textarea
        key="plan-editor"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onFocus={(e) =>
          // Keep the caret visible above the keyboard when the editor opens.
          e.currentTarget.scrollIntoView({ block: "nearest" })
        }
        placeholder="Write the plan in markdown…"
        aria-label="Plan markdown"
        className="msg-enter min-h-[50dvh] w-full resize-y rounded-control border border-border-strong bg-surface p-4 font-mono text-base leading-relaxed text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface placeholder:text-muted"
      />
    );
  }
  return (
    <div key="plan-view" className="msg-enter">
      <Markdown>{body}</Markdown>
    </div>
  );
}
