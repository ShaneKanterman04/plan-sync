import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { appendWorkspaceFiles } from "@/lib/db";
import { broadcast } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";
import { saveUploadedWorkspaceFiles } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAuth(req);
    const workspace = await readWorkspace(params);
    const uploaded = await saveUploadedWorkspaceFiles({
      workspace,
      formData: await req.formData(),
    });
    const uploadedList = uploaded.map((file) => file.path).join(", ");
    const { plan } = appendWorkspaceFiles({
      workspace,
      author: "human",
      files: uploaded.map((file) => ({ path: file.path, role: "reference" })),
      note: `Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}: ${uploadedList}`,
    });
    broadcast(workspace);
    return NextResponse.json({ plan, uploaded });
  } catch (error) {
    return fail(error);
  }
}
