"use client";

import { useEffect, useState } from "react";
import { useTheme, type ThemeChoice } from "@/components/useTheme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto" },
  { value: "dark", label: "Dark" },
];

/**
 * Segmented Light / Auto / Dark theme control. Renders as a `role="group"`
 * labelled "Theme" with three `aria-pressed` toggle buttons. The active choice
 * is persisted by useTheme (localStorage `plansync:theme`) and applied via the
 * documentElement `data-theme` attribute. All visuals use semantic tokens;
 * targets are >=44px with visible focus rings and reduced-motion-safe
 * transitions inherited from globals.css.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // Avoid a hydration mismatch: the server always renders the "auto" default,
  // so defer reflecting the resolved choice until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active: ThemeChoice = mounted ? theme : "auto";

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-1 rounded-control border border-border bg-surface p-1 shadow-card"
    >
      {OPTIONS.map((opt) => {
        const selected = active === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setTheme(opt.value)}
            className={
              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
              (selected
                ? "bg-accent-subtle text-accent-subtle-foreground"
                : "bg-transparent text-muted hover:text-foreground active:bg-surface-2")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
