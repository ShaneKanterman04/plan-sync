// Delimited-text (CSV/TSV) parsing + detection. Used to render spreadsheet
// documents — bodies that are a raw exported grid rather than markdown prose —
// as a real table instead of a wall of quoted text.

export type Grid = string[][];

export type Delimiter = "," | "\t";

// Parse delimited text into a grid of string cells. RFC-4180-ish: handles
// quoted fields, escaped quotes (""), and delimiters/newlines inside quotes.
// CRLF is normalised to LF.
export function parseDelimited(text: string, delimiter: Delimiter): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  // Flush the trailing field/row unless the text ended on a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Markdown-ish first lines (headings, fences, pipe tables, lists, blockquotes,
// frontmatter) are never treated as a raw spreadsheet.
const MARKDOWN_FIRST_LINE = /^\s*(#|`{3}|[-*+]\s|>\s|\||---\s*$)/;

// Detect a whole-body delimited table and return its grid + delimiter, or null.
// Conservative on purpose: requires a near-perfectly rectangular grid with at
// least two columns and two rows, so prose markdown is never mistaken for CSV.
export function detectSpreadsheet(text: string): { delimiter: Delimiter; grid: Grid } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const firstLine = trimmed.split("\n", 1)[0];
  if (MARKDOWN_FIRST_LINE.test(firstLine)) return null;

  const delimiters: Delimiter[] = [",", "\t"];
  for (const delimiter of delimiters) {
    if (!firstLine.includes(delimiter)) continue;
    const grid = parseDelimited(trimmed, delimiter);
    if (grid.length < 2) continue;
    const cols = grid[0].length;
    if (cols < 2) continue;
    const rectangular = grid.filter((r) => r.length === cols).length / grid.length;
    if (rectangular >= 0.9) return { delimiter, grid };
  }
  return null;
}
