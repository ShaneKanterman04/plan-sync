import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { Spreadsheet } from "@/components/Spreadsheet";

const grid = [
  ["Feature ID", "Name", "Status"],
  ["HCR-001", "Dashboard", "Implemented"],
  ["HCR-002", "Login", "Done"],
];

describe("Spreadsheet", () => {
  test("renders headers as column headers and data as cells", () => {
    render(<Spreadsheet grid={grid} />);
    expect(screen.getByRole("region", { name: "Spreadsheet" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Feature ID",
      "Name",
      "Status",
    ]);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  test("pins the first column (sticky left)", () => {
    render(<Spreadsheet grid={grid} />);
    expect(screen.getByText("HCR-001")).toHaveClass("sticky", "left-0");
  });

  test("renders nothing for an empty grid", () => {
    const { container } = render(<Spreadsheet grid={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
