import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  archiveDocument,
  deleteDocument,
  getDocument,
  getDocumentMessages,
  putDocument,
} from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, HttpError, readWorkspace } from "@/lib/http";
import { patchDocumentSchema, putDocumentSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string; doc: string }> };

// GET one extra document plus its discussion thread. (The primary plan is read
// via /api/w/[workspace] — this route serves the agent-published extra docs.)
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const { doc } = await params;
    const document = getDocument(workspace, doc);
    if (!document) throw new HttpError(404, "document not found");
    return NextResponse.json({ document, messages: getDocumentMessages(workspace, doc) });
  } catch (error) {
    return fail(error);
  }
}

// PUT the document body (re-publish / inline edit).
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const { doc } = await params;
    const input = putDocumentSchema.parse(await req.json());
    const document = putDocument({ workspace, ...input, docId: doc });
    broadcast(workspace);
    return NextResponse.json({ document });
  } catch (error) {
    return fail(error);
  }
}

// PATCH archive / unarchive.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const { doc } = await params;
    const input = patchDocumentSchema.parse(await req.json());
    const document = archiveDocument(workspace, doc, input.archived);
    if (!document) throw new HttpError(404, "document not found");
    broadcast(workspace);
    return NextResponse.json({ document });
  } catch (error) {
    return fail(error);
  }
}

// DELETE a document (and its thread).
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const { doc } = await params;
    if (!deleteDocument(workspace, doc)) throw new HttpError(404, "document not found");
    broadcast(workspace);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
