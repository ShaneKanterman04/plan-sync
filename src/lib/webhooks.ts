/**
 * Outbound webhook dispatch — the ONLY network I/O in the server library.
 *
 * `dispatchWebhooks` is a synchronous, fire-and-forget helper that write routes
 * call alongside `broadcast(workspace)`. It never awaits and never throws into
 * the request path: a slow, failing, or malicious webhook can therefore never
 * turn a successful write into a 4xx/5xx or leak a stack trace.
 *
 * Security (SSRF is the primary risk here):
 *   - Scheme allow-list (http/https) is re-checked here even though it is also
 *     enforced at registration, in case a stored row predates a schema change.
 *   - `isPublicHttpUrl` rejects credentials-in-URL, well-known metadata
 *     hostnames, and any literal host that parses to a loopback / private /
 *     link-local / unique-local / CGNAT address. Both IPv4 *and* IPv6 literals
 *     are byte-parsed and CIDR-checked (via `node:net`), including
 *     IPv4-mapped IPv6 (`::ffff:a.b.c.d` / `[::ffff:hhhh:hhhh]`) whose embedded
 *     IPv4 is re-checked against the v4 ranges — so the loopback and cloud
 *     metadata endpoints (e.g. 169.254.169.254 and its `::ffff:a9fe:a9fe`
 *     IPv6-mapped form) are blocked.
 *   - No DNS resolution is performed (literal-host blocking only), so a name
 *     that resolves to a private IP — including DNS-rebinding — is a known
 *     residual risk for the open-auth MVP. Well-known metadata names are still
 *     denied by label, and operators should keep webhook URLs public.
 *   - `redirect: "manual"` so a redirect is NEVER auto-followed. Without this,
 *     undici's default `redirect: "follow"` would chase a `3xx Location` (up to
 *     20 hops) into a host that `isPublicHttpUrl` never validated — e.g. a
 *     registered-public URL that 302s to `http://169.254.169.254/...` or
 *     `http://127.0.0.1/...`, and on 307/308 even replays the POST body and
 *     signature header. Manual mode discards the opaque redirect response, which
 *     is the correct fire-and-forget behavior.
 *   - `AbortSignal.timeout(5000)` caps every request (Node v22).
 *   - Optional HMAC-SHA256 `X-PlanSync-Signature` over the exact JSON body.
 */
import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { getStatus, listActiveWebhooks } from "@/lib/db";
import type { WebhookEvent, WebhookPayload } from "@/lib/types";

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Hostnames that always (or by well-known convention) resolve to a local
 * interface or a cloud metadata service. Matched as the full host or as a
 * dotted suffix (so `foo.localhost` / `x.metadata.google.internal` are caught).
 */
const BLOCKED_HOST_LABELS = [
  "localhost",
  "metadata", // bare label used inside some cloud VPCs
  "metadata.google.internal",
  "metadata.goog",
];

/** Reject an IPv4 address (as four octets) that is not globally routable. */
function isBlockedIPv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. 169.254.169.254 IMDS)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  return false;
}

/** Parse a dotted-quad string into four octets, or `null` if malformed. */
function parseIPv4(host: string): number[] | null {
  if (!isIPv4(host)) return null;
  const octets = host.split(".").map((p) => Number(p));
  return octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? octets
    : null;
}

/**
 * Expand an IPv6 literal (already validated by `isIPv6`) into its 16 bytes.
 * Handles `::` compression and a trailing embedded IPv4 (`::ffff:a.b.c.d`).
 */
function ipv6Bytes(host: string): number[] | null {
  let text = host;
  const v4Tail: number[] = [];
  // A trailing dotted-quad consumes the final 32 bits.
  const dotIdx = text.lastIndexOf(":");
  const maybeV4 = text.slice(dotIdx + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    v4Tail.push(...v4);
    text = text.slice(0, dotIdx + 1) + "0:0"; // placeholder hextets, overwritten below
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];

  const groups: number[] = [];
  const total = halves.length === 2 ? 8 - (head.length + tail.length) : 0;
  if (halves.length === 1 && head.length !== 8) return null;
  for (const g of head) groups.push(parseInt(g || "0", 16));
  for (let i = 0; i < total; i += 1) groups.push(0);
  for (const g of tail) groups.push(parseInt(g || "0", 16));
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!Number.isInteger(g) || g < 0 || g > 0xffff) return null;
    bytes.push((g >> 8) & 0xff, g & 0xff);
  }
  if (v4Tail.length === 4) {
    bytes[12] = v4Tail[0];
    bytes[13] = v4Tail[1];
    bytes[14] = v4Tail[2];
    bytes[15] = v4Tail[3];
  }
  return bytes.length === 16 ? bytes : null;
}

/** Reject an IPv6 address (as 16 bytes) that is not globally routable. */
function isBlockedIPv6(bytes: readonly number[]): boolean {
  const allZero = bytes.every((b) => b === 0);
  if (allZero) return true; // :: unspecified
  // ::1 loopback
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;
  // fc00::/7 unique-local (fc00 / fd00)
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  // ::ffff:0:0/96 IPv4-mapped — re-check the embedded IPv4.
  const mappedPrefix = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mappedPrefix) return isBlockedIPv4(bytes.slice(12));
  // ::ffff:0:0:.../  and ::/96 deprecated IPv4-compatible — re-check embedded IPv4.
  const compatPrefix = bytes.slice(0, 12).every((b) => b === 0);
  if (compatPrefix) return isBlockedIPv4(bytes.slice(12));
  return false;
}

/**
 * Returns `true` only for an `http`/`https` URL whose host carries no embedded
 * credentials and is not a loopback / private / link-local / unique-local /
 * CGNAT / metadata target. IPv4 and IPv6 literals (including IPv4-mapped IPv6)
 * are byte-parsed and CIDR-checked rather than string-matched. No DNS
 * resolution is performed (literal-host blocking only).
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Reject credentials-in-URL (user:pass@host).
  if (url.username || url.password) return false;

  // `URL.hostname` keeps IPv6 literals wrapped in brackets; strip them so the
  // value matches what `node:net` expects.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;

  // Well-known local / cloud-metadata hostnames (full match or dotted suffix).
  for (const label of BLOCKED_HOST_LABELS) {
    if (host === label || host.endsWith(`.${label}`)) return false;
  }

  // IPv4 literal: byte-parse and CIDR-check.
  const v4 = parseIPv4(host);
  if (v4) return !isBlockedIPv4(v4);

  // IPv6 literal (incl. IPv4-mapped/compatible): byte-parse and CIDR-check.
  // `URL.hostname` normalizes `::ffff:127.0.0.1` to the hex form
  // `[::ffff:7f00:1]`, so we must expand to bytes rather than regex the string.
  if (isIPv6(host)) {
    const bytes = ipv6Bytes(host);
    // Unparseable IPv6 literal — fail closed.
    if (!bytes) return false;
    return !isBlockedIPv6(bytes);
  }

  // A non-literal hostname (DNS name). Not resolved here; see header comment.
  return true;
}

/**
 * Best-effort delivery of `event` to every active, subscribed webhook for the
 * workspace. NEVER awaited, NEVER throws. A no-op (zero `fetch` calls) when the
 * workspace has no active webhooks.
 */
export function dispatchWebhooks(
  workspace: string,
  event: WebhookEvent,
  extra?: { messageId?: string },
): void {
  const hooks = listActiveWebhooks(workspace);
  if (hooks.length === 0) return; // ZERO network I/O when nothing is registered.

  const snapshot = getStatus(workspace);
  const payload: WebhookPayload = {
    workspace,
    event,
    version: snapshot?.version ?? 0,
    status: snapshot?.status ?? "draft",
    at: new Date().toISOString(),
    ...(extra?.messageId ? { messageId: extra.messageId } : {}),
  };
  const bodyStr = JSON.stringify(payload);

  for (const hook of hooks) {
    if (!hook.events.includes(event)) continue;
    if (!isPublicHttpUrl(hook.url)) continue;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-PlanSync-Event": event,
    };
    if (hook.secret) {
      const signature = createHmac("sha256", hook.secret).update(bodyStr).digest("hex");
      headers["X-PlanSync-Signature"] = `sha256=${signature}`;
    }

    // Fire-and-forget: never awaited, every rejection swallowed so a failing or
    // malicious endpoint can never surface in the originating request.
    // `redirect: "manual"` ensures a malicious endpoint cannot 3xx-bounce us into
    // a loopback/link-local/metadata host that `isPublicHttpUrl` never validated.
    void fetch(hook.url, {
      method: "POST",
      headers,
      body: bodyStr,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => {});
  }
}
