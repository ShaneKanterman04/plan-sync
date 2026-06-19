import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { addDocumentMessage, getDocument, getDocumentMessages } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, HttpError, readWorkspace } from "@/lib/http";
import { postMessageSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string; doc: string }> };

// GET the document's discussion thread.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const { doc } = await params;
    if (!getDocument(workspace, doc)) throw new HttpError(404, "document not found");
    return NextResponse.json({ messages: getDocumentMessages(workspace, doc) });
  } catch (error) {
    return fail(error);
  }
}

// POST a message to the document thread.
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const { doc } = await params;
    const input = postMessageSchema.parse(await req.json());
    const message = addDocumentMessage({ workspace, docId: doc, ...input });
    broadcast(workspace);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
