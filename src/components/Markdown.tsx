"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md text-[15px] text-gray-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {children?.trim() ? children : "_No plan written yet._"}
      </ReactMarkdown>
    </div>
  );
}
