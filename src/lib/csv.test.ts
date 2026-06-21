/**
 * @jest-environment node
 */

import { parseDelimited, detectSpreadsheet } from "@/lib/csv";

describe("parseDelimited", () => {
  test("parses a simple comma grid", () => {
    expect(parseDelimited("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("keeps delimiters and newlines inside quotes", () => {
    expect(parseDelimited('"a,b","c\nd"\n1,2', ",")).toEqual([
      ["a,b", "c\nd"],
      ["1", "2"],
    ]);
  });

  test("unescapes doubled quotes", () => {
    expect(parseDelimited('"she said ""hi""",x', ",")).toEqual([['she said "hi"', "x"]]);
  });

  test("ignores a trailing newline (no empty final row)", () => {
    expect(parseDelimited("a,b\n1,2\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("normalises CRLF and parses tab-separated values", () => {
    expect(parseDelimited("a\tb\r\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectSpreadsheet", () => {
  test("detects a quoted multi-column CSV body", () => {
    const csv =
      '"Feature ID","Name","Status"\n"HCR-001","Dashboard","Implemented"\n"HCR-002","Login","Implemented"';
    const res = detectSpreadsheet(csv);
    expect(res).not.toBeNull();
    expect(res?.delimiter).toBe(",");
    expect(res?.grid[0]).toEqual(["Feature ID", "Name", "Status"]);
    expect(res?.grid).toHaveLength(3);
  });

  test("detects a TSV body", () => {
    expect(detectSpreadsheet("a\tb\tc\n1\t2\t3")?.delimiter).toBe("\t");
  });

  test("rejects markdown prose (heading first line)", () => {
    expect(detectSpreadsheet("# Summary\n\nWe shipped X, Y, and Z today.")).toBeNull();
  });

  test("rejects a markdown pipe table", () => {
    expect(detectSpreadsheet("| a | b |\n|---|---|\n| 1 | 2 |")).toBeNull();
  });

  test("rejects prose with commas but no consistent grid", () => {
    expect(detectSpreadsheet("Hello, world.\nThis is a single sentence.")).toBeNull();
  });

  test("rejects an empty body", () => {
    expect(detectSpreadsheet("   ")).toBeNull();
  });
});
