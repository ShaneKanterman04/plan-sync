import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toggleReaction } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { postReactionSchema } from "@/lib/schema";
import { dispatchWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// POST toggles a single (message, emoji, author) reaction on/off.
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = postReactionSchema.parse(await req.json());
    const result = toggleReaction({ workspace, ...input });
    broadcast(workspace);
    void dispatchWebhooks(workspace, "message", { messageId: input.messageId });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}
