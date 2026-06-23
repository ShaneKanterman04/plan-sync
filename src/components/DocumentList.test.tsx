import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentSummary } from "@/lib/types";
import { DocumentList } from "@/components/DocumentList";

// DocumentList uses next/link — mock it to render a plain <a> so tests can
// inspect href and aria-current without needing a full Next.js router context.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Stub lucide-react icons so they render as accessible SVG placeholders rather
// than triggering ESM-resolution issues in jsdom.
jest.mock("lucide-react", () => ({
  ChevronRight: () => <svg data-testid="icon-chevron" aria-hidden="true" />,
  FileText: () => <svg data-testid="icon-file-text" aria-hidden="true" />,
  History: () => <svg data-testid="icon-history" aria-hidden="true" />,
  ScrollText: () => <svg data-testid="icon-scroll-text" aria-hidden="true" />,
}));

// --- Fixtures -----------------------------------------------------------------

function doc(
  overrides: Partial<DocumentSummary> & Pick<DocumentSummary, "docId" | "slug" | "title" | "documentType">,
): DocumentSummary {
  return {
    version: 1,
    isPrimary: false,
    archived: false,
    status: null,
    updatedAt: "2026-06-19T10:00:00.000Z",
    updatedBy: "agent",
    messageCount: 0,
    lastMessageAt: null,
    ...overrides,
  };
}

const primaryDoc: DocumentSummary = doc({
  docId: "primary",
  slug: "primary",
  title: "Implementation plan",
  documentType: "plan",
  isPrimary: true,
  status: "review",
  version: 3,
});

const summaryDoc: DocumentSummary = doc({
  docId: "summary-2026",
  slug: "summary-2026",
  title: "Project summary",
  documentType: "summary",
  messageCount: 2,
  lastMessageAt: "2026-06-19T09:00:00.000Z",
});

const retroDoc: DocumentSummary = doc({
  docId: "retro-q2",
  slug: "retro-q2",
  title: "Q2 retrospective",
  documentType: "retrospective",
});

const documents: DocumentSummary[] = [primaryDoc, summaryDoc, retroDoc];

// A workspace with enough summaries to trip the search box + default-collapse.
const manySummaries: DocumentSummary[] = [
  primaryDoc,
  ...Array.from({ length: 7 }, (_, i) =>
    doc({
      docId: `summary-${i + 1}`,
      slug: `summary-${i + 1}`,
      title: `Summary ${i + 1}`,
      documentType: "summary",
    }),
  ),
];

// --- Tests --------------------------------------------------------------------

describe("DocumentList", () => {
  test("renders nothing when documents array is empty", () => {
    const { container } = render(
      <DocumentList workspace="demo" documents={[]} currentDocId="primary" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("groups documents into type sections with counts (plan first)", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    expect(screen.getByRole("button", { name: /^Plan \(1\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Summaries \(1\)$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Retrospectives \(1\)$/ }),
    ).toBeInTheDocument();
  });

  test("renders one row per document, small sections open by default (primary first)", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent("Implementation plan");
    expect(links[1]).toHaveTextContent("Project summary");
    expect(links[2]).toHaveTextContent("Q2 retrospective");
  });

  test("primary row links to /w/[workspace] and extra rows link to /w/[workspace]/d/[slug]", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/w/demo");
    expect(links[1]).toHaveAttribute("href", "/w/demo/d/summary-2026");
    expect(links[2]).toHaveAttribute("href", "/w/demo/d/retro-q2");
  });

  test("the current document row has aria-current='page'", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    expect(
      screen.getByRole("link", { name: /Implementation plan/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("non-current rows do not have aria-current", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    expect(
      screen.getByRole("link", { name: /Project summary/ }),
    ).not.toHaveAttribute("aria-current");
  });

  test("switching currentDocId highlights the correct extra-doc row", () => {
    render(
      <DocumentList
        workspace="demo"
        documents={documents}
        currentDocId="summary-2026"
      />,
    );

    expect(
      screen.getByRole("link", { name: /Project summary/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: /Implementation plan/ }),
    ).not.toHaveAttribute("aria-current");
  });

  test("renders a StatusBadge only for the primary document", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    // The StatusBadge for "review" renders "In review" — exactly one (primary).
    expect(screen.getAllByTitle("In review")).toHaveLength(1);
  });

  test("shows the unread dot when messageCount > 0 with an accessible label", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    // summaryDoc has messageCount: 2.
    expect(screen.getByLabelText("2 messages")).toBeInTheDocument();
  });

  test("does not show an unread dot when messageCount is 0", () => {
    render(
      <DocumentList workspace="demo" documents={[primaryDoc, retroDoc]} currentDocId="primary" />,
    );

    expect(screen.queryByLabelText(/message/)).toBeNull();
  });

  test("includes vN and the author in the meta line", () => {
    render(
      <DocumentList workspace="demo" documents={[primaryDoc]} currentDocId="primary" />,
    );

    const link = screen.getByRole("link", { name: /Implementation plan/ });
    expect(link).toHaveTextContent("v3");
    expect(link).toHaveTextContent("agent");
  });

  test("encodes workspace and slug in hrefs when they contain special characters", () => {
    const spacedDoc: DocumentSummary = doc({
      docId: "my doc",
      slug: "my doc",
      title: "Spaced doc",
      documentType: "summary",
    });
    render(
      <DocumentList workspace="my workspace" documents={[spacedDoc]} currentDocId="other" />,
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/w/my%20workspace/d/my%20doc",
    );
  });

  // --- Collapse / expand -------------------------------------------------------

  test("collapses a large section by default and reveals its rows when expanded", async () => {
    const user = userEvent.setup();
    render(
      <DocumentList workspace="demo" documents={manySummaries} currentDocId="primary" />,
    );

    // The 7-summary section is collapsed by default; only the plan link shows.
    const summariesHeader = screen.getByRole("button", { name: /^Summaries \(7\)$/ });
    expect(summariesHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Summary 3/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Implementation plan/ })).toBeInTheDocument();

    await user.click(summariesHeader);

    expect(summariesHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Summary 3/ })).toBeInTheDocument();
  });

  test("keeps the section containing the current document open by default", () => {
    render(
      <DocumentList workspace="demo" documents={manySummaries} currentDocId="summary-4" />,
    );

    // Even though the summaries section is large, it holds the current doc.
    expect(screen.getByRole("button", { name: /^Summaries \(7\)$/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("link", { name: /Summary 4/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  // --- Search ------------------------------------------------------------------

  test("shows a search box only once a workspace has many documents", () => {
    const { rerender } = render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );
    expect(screen.queryByRole("searchbox", { name: /search documents/i })).toBeNull();

    rerender(
      <DocumentList workspace="demo" documents={manySummaries} currentDocId="primary" />,
    );
    expect(
      screen.getByRole("searchbox", { name: /search documents/i }),
    ).toBeInTheDocument();
  });

  test("typing in the search box filters across all sections and force-opens matches", async () => {
    const user = userEvent.setup();
    render(
      <DocumentList workspace="demo" documents={manySummaries} currentDocId="primary" />,
    );

    await user.type(
      screen.getByRole("searchbox", { name: /search documents/i }),
      "Summary 5",
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Summary 5");
  });

  test("shows an empty-state message when the search matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <DocumentList workspace="demo" documents={manySummaries} currentDocId="primary" />,
    );

    await user.type(
      screen.getByRole("searchbox", { name: /search documents/i }),
      "nonexistent-doc",
    );

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText(/No documents match/)).toBeInTheDocument();
  });
});
