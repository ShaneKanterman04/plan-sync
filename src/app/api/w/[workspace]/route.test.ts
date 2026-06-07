/**
 * @jest-environment node
 */

import { GET as exportGet } from "@/app/api/w/[workspace]/export/route";
import { PUT } from "@/app/api/w/[workspace]/route";

function ctx(workspace: string) {
  return { params: Promise.resolve({ workspace }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/w/demo", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace plan API files", () => {
  test("PUT accepts explicit files and export returns them", async () => {
    const res = await PUT(
      request({
        author: "agent",
        title: "Files",
        bodyMd: "# Plan",
        files: [
          { path: "docs/plan.md", role: "sync" },
          { path: "src/app/page.tsx", role: "reference" },
        ],
      }),
      ctx("api-files"),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plan.linkedFile).toBe("docs/plan.md");
    expect(data.plan.referencedFiles).toEqual(["src/app/page.tsx"]);
    expect(data.plan.files).toEqual([
      { path: "docs/plan.md", role: "sync" },
      { path: "src/app/page.tsx", role: "reference" },
    ]);

    const jsonExport = await exportGet(
      new Request("http://localhost/api/w/api-files/export?format=json"),
      ctx("api-files"),
    );
    const exported = await jsonExport.json();
    expect(exported.plan.files).toHaveLength(2);

    const markdownExport = await exportGet(
      new Request("http://localhost/api/w/api-files/export?format=markdown"),
      ctx("api-files"),
    );
    expect(await markdownExport.text()).toContain("## Workspace Files");
  });

  test("PUT rejects invalid file payloads", async () => {
    const res = await PUT(
      request({
        author: "agent",
        bodyMd: "# Plan",
        files: [{ path: "/tmp/plan.md", role: "sync" }],
      }),
      ctx("api-files-invalid"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "workspace file path must be relative: /tmp/plan.md",
    });
  });
});
