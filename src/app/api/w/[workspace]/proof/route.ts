import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { appendProof } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { postProofSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = postProofSchema.parse(await req.json());
    const result = appendProof({ workspace, ...input });
    broadcast(workspace);
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}
