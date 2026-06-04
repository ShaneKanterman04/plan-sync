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
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Write the plan in markdown…"
        className="min-h-[60vh] w-full resize-y rounded-xl border border-gray-300 bg-white p-4 font-mono text-[15px] leading-relaxed outline-none focus:border-gray-500"
      />
    );
  }
  return <Markdown>{body}</Markdown>;
}
