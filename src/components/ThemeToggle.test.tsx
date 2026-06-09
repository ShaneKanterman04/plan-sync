import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/ThemeToggle";

function mockMatchMedia(dark: boolean) {
  return jest.fn().mockImplementation((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe("ThemeToggle", () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: mockMatchMedia(false),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: realMatchMedia,
    });
  });

  test("renders a Theme group with Light / Auto / Dark options", () => {
    render(<ThemeToggle />);
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /auto/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });

  test("defaults to Auto pressed when nothing persisted", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /auto/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /dark/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("clicking Dark applies data-theme=dark, persists, and toggles aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /dark/i }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("plansync:theme")).toBe("dark");
    expect(screen.getByRole("button", { name: /dark/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /auto/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("clicking Auto removes data-theme and persists auto", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /dark/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: /auto/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem("plansync:theme")).toBe("auto");
    expect(screen.getByRole("button", { name: /auto/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
