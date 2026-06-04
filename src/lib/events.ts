/**
 * Server-Sent Events registry, keyed by workspace. Write routes call
 * `broadcast(workspace)` so connected clients can refetch. The MVP UI uses
 * polling; wiring an `EventSource` to a `/api/w/[workspace]/events` route that
 * returns `createEventStream(workspace)` upgrades it to push with no other
 * changes.
 */
type Client = {
  workspace: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const encoder = new TextEncoder();
const clients = new Set<Client>();

export function createEventStream(workspace: string) {
  return new ReadableStream({
    start(controller) {
      const client = { workspace, controller };
      clients.add(client);
      controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
    },
    cancel() {
      for (const client of clients) {
        if (client.workspace === workspace) clients.delete(client);
      }
    },
  });
}

export function broadcast(workspace: string, kind = "changed") {
  const payload = encoder.encode(
    `event: ${kind}\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
  );
  for (const client of [...clients]) {
    if (client.workspace !== workspace) continue;
    try {
      client.controller.enqueue(payload);
    } catch {
      clients.delete(client);
    }
  }
}
