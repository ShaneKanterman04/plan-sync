import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanView } from "@/components/PlanView";

// Markdown pulls in ESM-only deps that don't matter here; stub it to echo its
// children so we can assert Preview renders the draft verbatim.
jest.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

describe("PlanView", () => {
  test("edit mode: Write tab shows the markdown textarea with placeholder + aria-label", () => {
    const onDraftChange = jest.fn();
    render(
      <PlanView
        editing
        body="ignored body"
        draft="draft contents"
        onDraftChange={onDraftChange}
      />,
    );

    const textarea = screen.getByLabelText("Plan markdown");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("draft contents");
    expect(
      screen.getByPlaceholderText("Write the plan in markdown…"),
    ).toBe(textarea);

    // The segmented toggle is a tablist with Write + Preview tabs.
    const tablist = screen.getByRole("tablist", { name: "Editor mode" });
    expect(tablist).toBeInTheDocument();
    const writeTab = screen.getByRole("tab", { name: "Write" });
    expect(writeTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Preview" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  test("edit mode: Preview renders the current draft via Markdown, then Write restores the textarea draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = jest.fn();
    render(
      <PlanView
        editing
        body="ignored body"
        draft="# Heading draft"
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Preview" }));

    // Preview swaps the textarea out for the (mocked) Markdown of the draft.
    expect(screen.queryByLabelText("Plan markdown")).toBeNull();
    expect(screen.getByTestId("markdown")).toHaveTextContent("# Heading draft");
    expect(
      screen.getByRole("tab", { name: "Preview" }),
    ).toHaveAttribute("aria-selected", "true");

    // Back to Write: the textarea returns with the same draft value.
    await user.click(screen.getByRole("tab", { name: "Write" }));
    const textarea = screen.getByLabelText("Plan markdown");
    expect(textarea).toHaveValue("# Heading draft");
  });

  test("non-edit mode renders the body via Markdown and has no Write|Preview toggle", () => {
    render(
      <PlanView
        editing={false}
        body="rendered plan body"
        draft="unused draft"
        onDraftChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "rendered plan body",
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByLabelText("Plan markdown")).toBeNull();
  });
});
