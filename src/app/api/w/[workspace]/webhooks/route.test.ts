/**
 * @jest-environment node
 */

import { DELETE, GET, POST } from "@/app/api/w/[workspace]/webhooks/route";

function ctx(workspace: string) {
  return { params: Promise.resolve({ workspace }) };
}

function postRequest(workspace: string, body: unknown) {
  return new Request(`http://localhost/api/w/${workspace}/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("webhooks API", () => {
  test("POST registers an https webhook and never returns the secret", async () => {
    const ws = "hook-create";
    const res = await POST(
      postRequest(ws, {
        url: "https://example.com/hook",
        secret: "s3cr3t",
        events: ["status"],
      }),
      ctx(ws),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.webhook.url).toBe("https://example.com/hook");
    expect(data.webhook.hasSecret).toBe(true);
    expect(data.webhook).not.toHaveProperty("secret");

    const list = await GET(new Request(`http://localhost/api/w/${ws}/webhooks`), ctx(ws));
    const listData = await list.json();
    expect(listData.webhooks).toHaveLength(1);
    expect(listData.webhooks[0]).not.toHaveProperty("secret");
    expect(listData.webhooks[0].hasSecret).toBe(true);
  });

  test("POST rejects a non-http(s) URL (SSRF / scheme guard)", async () => {
    const ws = "hook-bad-scheme";
    const res = await POST(
      postRequest(ws, { url: "ftp://example.com/hook" }),
      ctx(ws),
    );
    expect(res.status).toBe(400);
  });

  test("POST rejects private/loopback/metadata hosts at registration (SSRF guard)", async () => {
    const ws = "hook-bad-host";
    for (const url of [
      "http://127.0.0.1:9000/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/hook",
      "http://10.0.0.5/hook",
      "http://[::1]/hook",
    ]) {
      const res = await POST(postRequest(ws, { url }), ctx(ws));
      expect(res.status).toBe(400);
    }
  });

  test("DELETE removes a webhook once, then reports not deleted", async () => {
    const ws = "hook-delete";
    const created = await POST(
      postRequest(ws, { url: "https://example.com/hook" }),
      ctx(ws),
    );
    const { webhook } = await created.json();

    const first = await DELETE(
      new Request(`http://localhost/api/w/${ws}/webhooks?id=${webhook.id}`, {
        method: "DELETE",
      }),
      ctx(ws),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ deleted: true });

    const second = await DELETE(
      new Request(`http://localhost/api/w/${ws}/webhooks?id=${webhook.id}`, {
        method: "DELETE",
      }),
      ctx(ws),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ deleted: false });
  });

  test("DELETE without an id returns 400 id is required", async () => {
    const ws = "hook-delete-noid";
    const res = await DELETE(
      new Request(`http://localhost/api/w/${ws}/webhooks`, { method: "DELETE" }),
      ctx(ws),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "id is required" });
  });

  test("POST enforces the per-workspace cap of 20", async () => {
    const ws = "hook-cap";
    for (let i = 0; i < 20; i++) {
      const ok = await POST(
        postRequest(ws, { url: `https://example.com/hook-${i}` }),
        ctx(ws),
      );
      expect(ok.status).toBe(201);
    }
    const over = await POST(
      postRequest(ws, { url: "https://example.com/hook-21" }),
      ctx(ws),
    );
    expect(over.status).toBe(400);
  });
});
