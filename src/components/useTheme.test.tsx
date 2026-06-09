import "@testing-library/jest-dom";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "@/components/useTheme";

/** Build a controllable matchMedia returning `dark` for the dark query. */
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

describe("useTheme", () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: realMatchMedia,
    });
  });

  test("defaults to auto when nothing is persisted", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: mockMatchMedia(false),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("auto");
  });

  test("setTheme('dark') sets data-theme=dark and persists plansync:theme", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: mockMatchMedia(false),
    });
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("plansync:theme")).toBe("dark");
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolved).toBe("dark");
  });

  test("setTheme('auto') removes the data-theme attribute and persists auto", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: mockMatchMedia(false),
    });
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    act(() => result.current.setTheme("auto"));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem("plansync:theme")).toBe("auto");
    expect(result.current.theme).toBe("auto");
  });

  test("resolved falls back to matchMedia when theme is auto", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: mockMatchMedia(true),
    });
    const { result } = renderHook(() => useTheme());
    // auto + system prefers dark → resolved dark.
    expect(result.current.theme).toBe("auto");
    expect(result.current.resolved).toBe("dark");
  });

  test("is jsdom-safe when matchMedia is undefined (resolves auto to light)", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("auto");
    expect(result.current.resolved).toBe("light");
  });
});
