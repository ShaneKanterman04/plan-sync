import { NextResponse } from "next/server";
import { getRevisions } from "@/lib/db";
import { fail, readWorkspace } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// GET the body-revision history (most recent first), optional `?limit=N`.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const limitParam = new URL(req.url).searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 50;
    return NextResponse.json({ revisions: getRevisions(workspace, limit) });
  } catch (error) {
    return fail(error);
  }
}
