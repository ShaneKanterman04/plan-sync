import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ensurePlan, getStatus, setStatus } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { patchStatusSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// GET just the status/version/updatedAt.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    ensurePlan(workspace);
    return NextResponse.json(getStatus(workspace));
  } catch (error) {
    return fail(error);
  }
}

// PATCH the status (transition-checked; logs an approve/request_changes/progress message).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = patchStatusSchema.parse(await req.json());
    const plan = setStatus({ workspace, ...input });
    broadcast(workspace);
    return NextResponse.json({ plan });
  } catch (error) {
    return fail(error);
  }
}
