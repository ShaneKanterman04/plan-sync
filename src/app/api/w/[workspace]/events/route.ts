import { ensurePlan } from "@/lib/db";
import { createEventStream } from "@/lib/events";
import { fail, readWorkspace } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

// SSE stream: clients open an EventSource here and get a 'changed' event each
// time a write route calls broadcast(workspace), replacing 5s polling.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const workspace = await readWorkspace(params);
    ensurePlan(workspace);
    return new Response(createEventStream(workspace), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
