"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { detectSpreadsheet } from "@/lib/csv";
import { Spreadsheet } from "@/components/Spreadsheet";

// Downshift user headings so user-authored markdown never injects a competing
// page <h1> and the document outline stays sane (h1->h2, h2->h3, h3->h4).
const components: Components = {
  h1: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  h2: ({ children, ...props }) => <h3 {...props}>{children}</h3>,
  h3: ({ children, ...props }) => <h4 {...props}>{children}</h4>,
};

export function Markdown({ children }: { children: string }) {
  const body = children?.trim() ? children : "_No plan written yet._";

  // A whole-body CSV/TSV document (e.g. an exported tracker) renders as a real
  // spreadsheet rather than a wall of quoted prose. Rendered outside the `.md`
  // wrapper so the markdown table styles don't bleed into the grid.
  const sheet = detectSpreadsheet(body);
  if (sheet) {
    return <Spreadsheet grid={sheet.grid} />;
  }

  return (
    <div className="md text-base text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
