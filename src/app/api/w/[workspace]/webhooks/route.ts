import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createWebhook, deleteWebhook, listWebhooks } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, HttpError, readWorkspace } from "@/lib/http";
import { postWebhookSchema } from "@/lib/schema";
import { isPublicHttpUrl } from "@/lib/webhooks";
import type { Webhook } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

/** Strip the plaintext secret before returning a webhook over the wire. */
function redactWebhook(webhook: Webhook) {
  const { secret, ...rest } = webhook;
  return { ...rest, hasSecret: secret.length > 0 };
}

// GET lists the workspace's webhooks (secrets redacted). No auth, like other reads.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    return NextResponse.json({
      webhooks: listWebhooks(workspace).map(redactWebhook),
    });
  } catch (error) {
    return fail(error);
  }
}

// POST registers a webhook (http/https only, per-workspace cap enforced in db).
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = postWebhookSchema.parse(await req.json());
    // Defense in depth: reject loopback/private/link-local/metadata hosts at
    // registration (the same egress guard re-checks before every delivery), so a
    // caller can't store a dead webhook that silently never fires.
    if (!isPublicHttpUrl(input.url)) {
      throw new HttpError(
        400,
        "webhook url must be a public http(s) address (loopback, private, link-local, and metadata hosts are not allowed)",
      );
    }
    const webhook = createWebhook({
      workspace,
      url: input.url,
      events: input.events,
      secret: input.secret,
      active: input.active,
    });
    broadcast(workspace);
    return NextResponse.json({ webhook: redactWebhook(webhook) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

// DELETE removes a webhook by `?id=`.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      throw new HttpError(400, "id is required");
    }
    const deleted = deleteWebhook(workspace, id);
    broadcast(workspace);
    return NextResponse.json({ deleted });
  } catch (error) {
    return fail(error);
  }
}
