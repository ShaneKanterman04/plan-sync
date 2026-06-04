import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { workspaceNameSchema } from "@/lib/schema";

/** An error carrying an HTTP status code. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

/** Validate the `[workspace]` dynamic segment (Next 16 async params). */
export async function readWorkspace(params: Promise<{ workspace: string }>): Promise<string> {
  const { workspace } = await params;
  const parsed = workspaceNameSchema.safeParse(workspace);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid workspace name.");
  }
  return parsed.data;
}

/** Turn a thrown error into a JSON error response with a sensible status. */
export function fail(error: unknown) {
  if (error instanceof ZodError) {
    const message = error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : 400;
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message }, { status });
}
