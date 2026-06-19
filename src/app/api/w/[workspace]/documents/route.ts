import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listWorkspaceDocuments, putDocument } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { putDocumentSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// GET the workspace's document list (primary plan pinned first, then extras).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    return NextResponse.json({ documents: listWorkspaceDocuments(workspace) });
  } catch (error) {
    return fail(error);
  }
}

// POST a new (or re-published) document. Identified by docId or title-slug.
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = putDocumentSchema.parse(await req.json());
    const document = putDocument({ workspace, ...input });
    broadcast(workspace);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
