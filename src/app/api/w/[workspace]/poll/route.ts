import { NextResponse } from "next/server";
import { ensurePlan, pollSnapshot } from "@/lib/db";
import { fail, readWorkspace } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// The cheap snapshot agents poll on a loop to detect a human response.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    ensurePlan(workspace);
    return NextResponse.json(pollSnapshot(workspace));
  } catch (error) {
    return fail(error);
  }
}
