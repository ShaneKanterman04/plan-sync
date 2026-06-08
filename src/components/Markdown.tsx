"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Downshift user headings so user-authored markdown never injects a competing
// page <h1> and the document outline stays sane (h1->h2, h2->h3, h3->h4).
const components: Components = {
  h1: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  h2: ({ children, ...props }) => <h3 {...props}>{children}</h3>,
  h3: ({ children, ...props }) => <h4 {...props}>{children}</h4>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md text-base text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children?.trim() ? children : "_No plan written yet._"}
      </ReactMarkdown>
    </div>
  );
}
