import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ensurePlan, getMessages, putPlanBody } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { putPlanSchema } from "@/lib/schema";
import { dispatchWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// GET the full plan + message thread (auto-creates an empty draft on first read).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const plan = ensurePlan(workspace);
    return NextResponse.json({ plan, messages: getMessages(workspace, undefined, "human") });
  } catch (error) {
    return fail(error);
  }
}

// PUT the plan body (agent writes a proposal, or human saves an inline edit).
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = putPlanSchema.parse(await req.json());
    const plan = putPlanBody({ workspace, ...input });
    broadcast(workspace);
    void dispatchWebhooks(workspace, "plan");
    return NextResponse.json({ plan });
  } catch (error) {
    return fail(error);
  }
}
