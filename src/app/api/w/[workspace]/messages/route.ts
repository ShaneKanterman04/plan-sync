import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { addMessage, getMessages } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { postMessageSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// GET the thread, optionally only messages after `?since=<ISO>` (agent incremental poll).
export async function GET(req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const since = new URL(req.url).searchParams.get("since") ?? undefined;
    return NextResponse.json({ messages: getMessages(workspace, since) });
  } catch (error) {
    return fail(error);
  }
}

// POST a message (human "talk back", or agent progress/check report).
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const input = postMessageSchema.parse(await req.json());
    const message = addMessage({ workspace, ...input });
    broadcast(workspace);
    return NextResponse.json({ message });
  } catch (error) {
    return fail(error);
  }
}
