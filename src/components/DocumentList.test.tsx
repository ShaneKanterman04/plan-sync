import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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

// --- Tests --------------------------------------------------------------------

describe("DocumentList", () => {
  test("renders nothing when documents array is empty", () => {
    const { container } = render(
      <DocumentList workspace="demo" documents={[]} currentDocId="primary" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders one row per document in the supplied order (primary first)", () => {
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

    const currentLink = screen.getByRole("link", { name: /Implementation plan/ });
    expect(currentLink).toHaveAttribute("aria-current", "page");
  });

  test("non-current rows do not have aria-current", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    const nonCurrentLink = screen.getByRole("link", { name: /Project summary/ });
    expect(nonCurrentLink).not.toHaveAttribute("aria-current");
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

  test("renders a StatusBadge for the primary document", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    // The StatusBadge for "review" renders "In review".
    expect(screen.getByTitle("In review")).toBeInTheDocument();
  });

  test("does not render a StatusBadge for non-primary documents", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    // There should be exactly one status badge (the primary plan's).
    expect(screen.getAllByTitle("In review")).toHaveLength(1);
  });

  test("renders DocumentTypeBadge for each document", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    expect(screen.getByTitle("Plan")).toBeInTheDocument();
    expect(screen.getByTitle("Summary")).toBeInTheDocument();
    expect(screen.getByTitle("Retrospective")).toBeInTheDocument();
  });

  test("shows the unread dot when messageCount > 0 with an accessible label", () => {
    render(
      <DocumentList workspace="demo" documents={documents} currentDocId="primary" />,
    );

    // summaryDoc has messageCount: 2.
    const dot = screen.getByLabelText("2 messages");
    expect(dot).toBeInTheDocument();
  });

  test("does not show an unread dot when messageCount is 0", () => {
    render(
      <DocumentList workspace="demo" documents={[primaryDoc, retroDoc]} currentDocId="primary" />,
    );

    // Neither fixture has messages.
    expect(screen.queryByLabelText(/message/)).toBeNull();
  });

  test("includes vN in the meta line", () => {
    render(
      <DocumentList workspace="demo" documents={[primaryDoc]} currentDocId="primary" />,
    );

    // primaryDoc has version: 3.
    expect(screen.getByRole("link", { name: /Implementation plan/ })).toHaveTextContent("v3");
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

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/w/my%20workspace/d/my%20doc");
  });
});
