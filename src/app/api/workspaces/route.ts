import { NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/db";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ workspaces: listWorkspaces() });
  } catch (error) {
    return fail(error);
  }
}
