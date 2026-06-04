import { LIST_CHANNEL, createEventStream } from "@/lib/events";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE stream for the workspace-list view: clients open an EventSource here and
// get a 'changed' event each time any write route calls broadcast(), replacing
// the home page's 5s polling.
export function GET() {
  try {
    return new Response(createEventStream(LIST_CHANNEL), {
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
