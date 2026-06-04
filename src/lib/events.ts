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

/**
 * Reserved channel for the workspace-list view. Any per-workspace change also
 * affects the list (status, version, last message), so `broadcast` fans out to
 * subscribers of this channel too. The workspace name schema rejects this value,
 * so it can never collide with a real workspace.
 */
export const LIST_CHANNEL = "*list*";

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
  // Notify both the workspace's own subscribers and the list view, since any
  // workspace change also alters the list (unless we're broadcasting the list).
  const channels = workspace === LIST_CHANNEL ? [LIST_CHANNEL] : [workspace, LIST_CHANNEL];
  for (const client of [...clients]) {
    if (!channels.includes(client.workspace)) continue;
    try {
      client.controller.enqueue(payload);
    } catch {
      clients.delete(client);
    }
  }
}
