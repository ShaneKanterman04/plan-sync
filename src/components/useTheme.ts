"use client";

import { useCallback, useEffect, useState } from "react";

/** A user's explicit theme choice; "auto" follows the OS preference. */
export type ThemeChoice = "light" | "dark" | "auto";
/** The concrete theme actually in effect after resolving "auto". */
export type ResolvedTheme = "light" | "dark";

/** Exact key shared with the no-FOUC bootstrap script in layout.tsx. */
const THEME_KEY = "plansync:theme";

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "auto";
}

/** Read the persisted choice, preferring an already-applied data-theme so the
 *  hook agrees with the pre-paint bootstrap. Guards all browser globals. */
function readInitialTheme(): ThemeChoice {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") return attr;
  }
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(THEME_KEY);
      if (isThemeChoice(stored)) return stored;
    }
  } catch {
    // localStorage can throw (private mode, disabled storage) — ignore.
  }
  return "auto";
}

function prefersDark(): boolean {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  } catch {
    // matchMedia unavailable (e.g. jsdom without a polyfill) — treat as light.
  }
  return false;
}

/**
 * Theme controller. `theme` is the user's choice (light/dark/auto), `resolved`
 * is the concrete light/dark currently in effect (resolving "auto" against the
 * system preference), and `setTheme` persists + applies the choice by toggling
 * the documentElement `data-theme` attribute that globals.css keys off.
 */
export function useTheme(): {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  resolved: ResolvedTheme;
} {
  const [theme, setThemeState] = useState<ThemeChoice>("auto");
  const [systemDark, setSystemDark] = useState<boolean>(false);

  // Hydrate from the already-applied attribute / storage after mount so SSR and
  // the first client render agree (both default to "auto").
  useEffect(() => {
    setThemeState(readInitialTheme());
    setSystemDark(prefersDark());
  }, []);

  // Track live OS changes so "auto" stays correct without a reload.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (t === "auto") {
        // Unset the attribute so the prefers-color-scheme fallback resumes.
        delete root.dataset.theme;
        root.removeAttribute("data-theme");
      } else {
        root.dataset.theme = t;
      }
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(THEME_KEY, t);
      }
    } catch {
      // Persisting is best-effort; the in-memory choice still applies.
    }
  }, []);

  const resolved: ResolvedTheme =
    theme !== "auto" ? theme : systemDark ? "dark" : "light";

  return { theme, setTheme, resolved };
}
