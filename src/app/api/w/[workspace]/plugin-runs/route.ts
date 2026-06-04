import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createPluginRun, listPluginRuns, updatePluginRun } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { patchPluginRunSchema, postPluginRunSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const limitParam = new URL(req.url).searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 20;
    return NextResponse.json({ runs: listPluginRuns(workspace, limit) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = postPluginRunSchema.parse(await req.json());
    const run = createPluginRun({ workspace, ...input });
    broadcast(workspace);
    return NextResponse.json({ run });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = patchPluginRunSchema.parse(await req.json());
    const run = updatePluginRun({ workspace, ...input });
    broadcast(workspace);
    return NextResponse.json({ run });
  } catch (error) {
    return fail(error);
  }
}
