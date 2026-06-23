"use client";

import type { Grid } from "@/lib/csv";

// Renders a delimited grid (CSV/TSV) as a faithful, scrollable spreadsheet:
// the viewport scrolls in both directions, the header row stays pinned to the
// top, and the first column stays pinned to the left so a wide audit table is
// still legible on a phone. Sticky cells use opaque row backgrounds so content
// scrolling underneath them is covered.
export function Spreadsheet({ grid }: { grid: Grid }) {
  if (grid.length === 0) return null;
  const [header, ...rows] = grid;

  return (
    <div
      className="max-h-[75vh] overflow-auto rounded-card border border-border"
      role="region"
      aria-label="Spreadsheet"
      tabIndex={0}
    >
      <table className="w-max min-w-full border-collapse text-left text-[0.8125rem] leading-5">
        <thead>
          <tr>
            {header.map((cell, c) => (
              <th
                key={c}
                scope="col"
                className={
                  "sticky top-0 border-b border-border-strong bg-surface-2 px-3 py-2 align-top font-semibold text-foreground " +
                  (c === 0 ? "left-0 z-30" : "z-20")
                }
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const rowBg = r % 2 === 0 ? "bg-surface" : "bg-surface-2";
            return (
              <tr key={r}>
                {header.map((_, c) => (
                  <td
                    key={c}
                    className={
                      `${rowBg} border-b border-border px-3 py-2 align-top whitespace-pre-wrap break-words ` +
                      (c === 0
                        ? "sticky left-0 z-10 min-w-[6rem] font-medium text-foreground"
                        : "max-w-[22rem] text-muted")
                    }
                  >
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
