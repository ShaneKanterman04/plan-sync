/**
 * @jest-environment node
 */

import { GET as exportGet } from "@/app/api/w/[workspace]/export/route";
import { PUT } from "@/app/api/w/[workspace]/route";
import { POST as uploadPost } from "@/app/api/w/[workspace]/uploads/route";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

describe("workspace upload API", () => {
  let uploadWorkspace: string;

  beforeEach(async () => {
    uploadWorkspace = await mkdtemp(path.join(os.tmpdir(), "plansync-upload-root-"));
    process.env.PLAN_UPLOAD_ROOT = path.join(uploadWorkspace, ".plan-sync", "uploads");
  });

  afterEach(async () => {
    await rm(uploadWorkspace, { recursive: true, force: true });
    delete process.env.PLAN_UPLOAD_ROOT;
  });

  function uploadRequest(files: File[]) {
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    return new Request("http://localhost/api/w/demo/uploads", {
      method: "POST",
      body: formData,
    });
  }

  test("uploads a CSV and appends it as a reference workspace file", async () => {
    await PUT(
      request({
        author: "agent",
        bodyMd: "# Plan",
        files: [{ path: "docs/plan.md", role: "sync" }],
      }),
      ctx("api-upload"),
    );

    const res = await uploadPost(
      uploadRequest([new File(["name,value\nalpha,1\n"], "Risk Register.csv", { type: "text/csv" })]),
      ctx("api-upload"),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uploaded).toHaveLength(1);
    expect(data.uploaded[0].path).toMatch(
      /^\.plan-sync\/uploads\/api-upload\/.+-Risk-Register\.csv$/,
    );
    expect(data.plan.files).toEqual([
      { path: "docs/plan.md", role: "sync" },
      { path: data.uploaded[0].path, role: "reference" },
    ]);
    expect(data.plan.version).toBe(2);
    expect(existsSync(path.join(uploadWorkspace, data.uploaded[0].path))).toBe(true);

    const jsonExport = await exportGet(
      new Request("http://localhost/api/w/api-upload/export?format=json"),
      ctx("api-upload"),
    );
    const exported = await jsonExport.json();
    expect(exported.messages.at(-1).body).toContain("Uploaded 1 file");
  });

  test("rejects empty uploads, unsupported extensions, and oversized files", async () => {
    const empty = await uploadPost(uploadRequest([]), ctx("api-upload-empty"));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "no upload files provided" });

    const unsupported = await uploadPost(
      uploadRequest([new File(["x"], "report.exe", { type: "application/octet-stream" })]),
      ctx("api-upload-unsupported"),
    );
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ error: "unsupported upload file type: .exe" });

    const oversized = await uploadPost(
      uploadRequest([new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.csv")]),
      ctx("api-upload-large"),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "upload file exceeds 10 MB: large.csv" });
  });
});

describe("workspace plan API webhook dispatch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("PUT makes ZERO fetch calls when no webhooks are registered", async () => {
    const fetchMock = jest.fn(async () => new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await PUT(
      request({ author: "agent", bodyMd: "# Plan" }),
      ctx("api-webhook-noop"),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
