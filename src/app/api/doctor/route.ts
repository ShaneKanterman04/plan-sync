import { NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/db";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const workspaces = listWorkspaces();
    return NextResponse.json({
      ok: true,
      serverTime: new Date().toISOString(),
      authEnabled: Boolean(process.env.PLAN_API_TOKEN),
      dataDirConfigured: Boolean(process.env.DATA_DIR),
      workspaceCount: workspaces.length,
      statuses: workspaces.reduce<Record<string, number>>((acc, workspace) => {
        acc[workspace.status] = (acc[workspace.status] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return fail(error);
  }
}
