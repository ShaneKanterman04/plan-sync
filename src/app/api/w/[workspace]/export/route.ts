import { NextResponse } from "next/server";
import { ensurePlan, getMessages, getRevisions, staleReasons } from "@/lib/db";
import { fail, readWorkspace } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

function markdownExport(workspace: string) {
  const plan = ensurePlan(workspace);
  const messages = getMessages(workspace);
  const revisions = getRevisions(workspace, 200);
  const stale = staleReasons(plan);
  const lines = [
    `# ${plan.title || plan.workspace}`,
    "",
    "## Metadata",
    "",
    `- Workspace: ${plan.workspace}`,
    `- Type: ${plan.documentType}`,
    `- Status: ${plan.status}`,
    `- Version: ${plan.version}`,
    `- Updated: ${plan.updatedAt}`,
    `- Updated by: ${plan.updatedBy}`,
  ];
  if (plan.linkedFile) lines.push(`- Linked file: ${plan.linkedFile}`);
  if (plan.sourceBranch) lines.push(`- Source branch: ${plan.sourceBranch}`);
  if (plan.sourceSha) lines.push(`- Source SHA: ${plan.sourceSha}`);
  if (plan.approvedAt) lines.push(`- Approved at: ${plan.approvedAt}`);
  if (plan.approvedVersion !== null) lines.push(`- Approved version: ${plan.approvedVersion}`);
  if (stale.length) {
    lines.push("", "## Stale Warnings", "");
    for (const reason of stale) lines.push(`- ${reason}`);
  }
  if (plan.referencedFiles.length) {
    lines.push("", "## Referenced Files", "");
    for (const file of plan.referencedFiles) lines.push(`- ${file}`);
  }
  lines.push("", "## Body", "", plan.bodyMd || "_No plan written yet._");
  lines.push("", "## Messages", "");
  if (messages.length === 0) {
    lines.push("_No messages._");
  } else {
    for (const message of messages) {
      lines.push(`- ${message.createdAt} [${message.author}/${message.kind}] ${message.body}`);
    }
  }
  lines.push("", "## Revisions", "");
  if (revisions.length === 0) {
    lines.push("_No revisions._");
  } else {
    for (const revision of revisions) {
      lines.push(
        `- v${revision.version} ${revision.createdAt} by ${revision.author} (${revision.status})`,
      );
    }
  }
  return lines.join("\n");
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    const format = new URL(req.url).searchParams.get("format") ?? "markdown";
    const plan = ensurePlan(workspace);
    const messages = getMessages(workspace);
    const revisions = getRevisions(workspace, 200);
    if (format === "json") {
      return NextResponse.json({
        plan,
        messages,
        revisions,
        staleReasons: staleReasons(plan),
        exportedAt: new Date().toISOString(),
      });
    }
    if (format !== "markdown") {
      return NextResponse.json({ error: "format must be markdown or json" }, { status: 400 });
    }
    return new NextResponse(markdownExport(workspace), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
