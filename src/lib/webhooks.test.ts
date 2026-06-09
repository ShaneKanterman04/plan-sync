/**
 * @jest-environment node
 */

import { createHmac } from "node:crypto";
import { createWebhook, putPlanBody } from "@/lib/db";
import { dispatchWebhooks } from "@/lib/webhooks";

type FetchArgs = [string, RequestInit];

function mockFetch() {
  const fn = jest.fn(
    async () => new Response("ok", { status: 200 }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("dispatchWebhooks", () => {
  test("is a no-op (zero fetch) when no webhooks are registered", () => {
    const fetchMock = mockFetch();
    dispatchWebhooks("webhook-none", "plan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("posts the WebhookPayload to one active matching hook and returns void", async () => {
    const ws = "webhook-deliver";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    createWebhook({ workspace: ws, url: "https://example.com/hook", events: ["plan"] });

    const fetchMock = mockFetch();
    const result = dispatchWebhooks(ws, "plan");
    expect(result).toBeUndefined();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ workspace: ws, event: "plan", status: "draft" });
    expect(typeof body.version).toBe("number");
    expect(typeof body.at).toBe("string");
  });

  test("signs the body with HMAC-SHA256 when a secret is set, and omits the header otherwise", async () => {
    const signed = "webhook-signed";
    const unsigned = "webhook-unsigned";
    putPlanBody({ workspace: signed, author: "agent", bodyMd: "# Plan" });
    putPlanBody({ workspace: unsigned, author: "agent", bodyMd: "# Plan" });
    createWebhook({
      workspace: signed,
      url: "https://example.com/signed",
      events: ["plan"],
      secret: "topsecret",
    });
    createWebhook({ workspace: unsigned, url: "https://example.com/unsigned", events: ["plan"] });

    const fetchMock = mockFetch();
    dispatchWebhooks(signed, "plan");
    const [, signedInit] = fetchMock.mock.calls[0] as unknown as FetchArgs;
    const headers = signedInit.headers as Record<string, string>;
    const expected =
      "sha256=" +
      createHmac("sha256", "topsecret").update(signedInit.body as string).digest("hex");
    expect(headers["X-PlanSync-Signature"]).toBe(expected);

    fetchMock.mockClear();
    dispatchWebhooks(unsigned, "plan");
    const [, unsignedInit] = fetchMock.mock.calls[0] as unknown as FetchArgs;
    expect(unsignedInit.headers as Record<string, string>).not.toHaveProperty(
      "X-PlanSync-Signature",
    );
  });

  test("does not deliver an event the hook is not subscribed to", () => {
    const ws = "webhook-event-filter";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    createWebhook({ workspace: ws, url: "https://example.com/hook", events: ["status"] });

    const fetchMock = mockFetch();
    dispatchWebhooks(ws, "plan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("blocks SSRF targets (loopback, link-local, private, localhost) without fetching", () => {
    const ws = "webhook-ssrf";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    for (const url of [
      "http://127.0.0.1/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.1/hook",
      "http://localhost/hook",
    ]) {
      createWebhook({ workspace: ws, url, events: ["plan"] });
    }

    const fetchMock = mockFetch();
    dispatchWebhooks(ws, "plan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("blocks IPv6, IPv4-mapped-IPv6, and metadata-DNS SSRF bypasses without fetching", () => {
    const ws = "webhook-ssrf-v6";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    for (const url of [
      "http://[::1]/hook", // IPv6 loopback
      "http://[::]/hook", // IPv6 unspecified
      "http://[fd00::1]/hook", // IPv6 unique-local (fc00::/7)
      "http://[fe80::1]/hook", // IPv6 link-local
      "http://[::ffff:127.0.0.1]/hook", // IPv4-mapped loopback
      "http://[::ffff:169.254.169.254]/latest/meta-data", // IPv4-mapped cloud metadata
      "http://[::ffff:10.0.0.1]/hook", // IPv4-mapped private
      "http://metadata.google.internal/computeMetadata/v1/", // GCP metadata DNS name
      "http://100.64.0.1/hook", // CGNAT 100.64.0.0/10
      "http://0.0.0.0/hook", // 0.0.0.0/8
    ]) {
      createWebhook({ workspace: ws, url, events: ["plan"] });
    }

    const fetchMock = mockFetch();
    dispatchWebhooks(ws, "plan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("still delivers to a public IPv6 literal host", async () => {
    const ws = "webhook-public-v6";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    createWebhook({
      workspace: ws,
      url: "http://[2001:4860:4860::8888]/hook",
      events: ["plan"],
    });

    const fetchMock = mockFetch();
    dispatchWebhooks(ws, "plan");
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe("http://[2001:4860:4860::8888]/hook");
  });

  test("skips inactive webhooks", () => {
    const ws = "webhook-inactive";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    createWebhook({
      workspace: ws,
      url: "https://example.com/hook",
      events: ["plan"],
      active: false,
    });

    const fetchMock = mockFetch();
    dispatchWebhooks(ws, "plan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("never throws even when fetch rejects", async () => {
    const ws = "webhook-reject";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    createWebhook({ workspace: ws, url: "https://example.com/hook", events: ["plan"] });

    const fetchMock = jest.fn(() => Promise.reject(new Error("network down")));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(() => dispatchWebhooks(ws, "plan")).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Let the rejected promise settle so the .catch() runs without leaking.
    await Promise.resolve();
  });

  test("passes redirect:'manual' so a 3xx into a blocked host is never followed", async () => {
    const ws = "webhook-redirect";
    putPlanBody({ workspace: ws, author: "agent", bodyMd: "# Plan" });
    // Registered as a *public* URL — isPublicHttpUrl accepts it. The danger is a
    // server-side redirect into a loopback/link-local host the allow-list never saw.
    createWebhook({ workspace: ws, url: "https://example.com/hook", events: ["plan"] });

    // Mock fetch to emulate a 302 Location: http://169.254.169.254/. With the
    // default redirect:"follow" undici would issue a SECOND fetch to the metadata
    // host; with redirect:"manual" the dispatcher must never chase it.
    const fetchMock = jest.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data/" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    dispatchWebhooks(ws, "plan");
    await Promise.resolve();

    // Exactly one fetch — to the registered host only, never the blocked target.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe("https://example.com/hook");
    expect(init.redirect).toBe("manual");
  });
});
