import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Message, Plan } from "@/lib/types";
import WorkspacePage from "./page";

jest.mock("next/navigation", () => ({
  useParams: () => ({ workspace: "demo" }),
}));

// Markdown pulls in ESM-only deps that don't matter for this test; stub it out.
jest.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

// --- Mock EventSource ---------------------------------------------------------

type Listener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, Set<Listener>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  // Test helper: deliver a server-sent event to all listeners.
  emit(type: string, data: unknown = {}) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

// --- Fixtures -----------------------------------------------------------------

const plan: Plan = {
  workspace: "demo",
  title: "Initial plan",
  bodyMd: "# Initial plan body",
  status: "review",
  version: 1,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
  updatedBy: "agent",
};

const firstMessages: Message[] = [
  {
    id: "m1",
    workspace: "demo",
    author: "agent",
    kind: "note",
    body: "Original message",
    createdAt: "2026-06-04T00:00:00.000Z",
  },
];

const secondMessages: Message[] = [
  ...firstMessages,
  {
    id: "m2",
    workspace: "demo",
    author: "human",
    kind: "note",
    body: "Pushed via SSE",
    createdAt: "2026-06-04T00:01:00.000Z",
  },
];

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as unknown as Response;
}

// The removed polling used `setInterval(load, 5000)`. Isolate any 5s-delay
// timer calls so framework-internal timers (with other delays) don't count.
function pollingTimerCalls(spy: jest.SpyInstance) {
  return spy.mock.calls.filter(([, delay]) => delay === 5000);
}

describe("WorkspacePage SSE wiring", () => {
  let fetchMock: jest.Mock;
  let setIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;

    fetchMock = jest.fn();
    // First GET returns the original thread; every later GET returns the updated one.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ plan, messages: firstMessages }))
      .mockResolvedValue(jsonResponse({ plan, messages: secondMessages }));
    global.fetch = fetchMock as unknown as typeof fetch;

    setIntervalSpy = jest.spyOn(global, "setInterval");
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    jest.clearAllMocks();
  });

  test("loads initially and opens an EventSource (no polling)", async () => {
    render(<WorkspacePage />);

    // Initial load resolves the plan + first message.
    await screen.findByText("Original message");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/w/demo",
      expect.any(Object),
    );

    // An EventSource was opened against the events route.
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/w/demo/events");

    // Polling has been removed entirely: the component never starts the old 5s
    // refetch timer. (Test-framework timers may use setInterval, so we assert on
    // the 5000ms delay specifically rather than zero total calls.)
    expect(pollingTimerCalls(setIntervalSpy)).toHaveLength(0);
  });

  test("a 'changed' SSE event triggers an immediate load() and UI update", async () => {
    render(<WorkspacePage />);

    await screen.findByText("Original message");
    const callsAfterInitialLoad = fetchMock.mock.calls.length;
    expect(screen.queryByText("Pushed via SSE")).toBeNull();

    const source = MockEventSource.instances[0];

    const start = Date.now();
    await act(async () => {
      source.emit("changed");
    });

    // The event drove a refetch (load called again, no timer involved).
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(callsAfterInitialLoad + 1),
    );

    // New message appears as a direct result of the SSE event...
    await screen.findByText("Pushed via SSE");
    // ...and well within 100ms (i.e. not waiting for any 5s poll).
    expect(Date.now() - start).toBeLessThan(100);

    expect(pollingTimerCalls(setIntervalSpy)).toHaveLength(0);
  });

  test("closes the EventSource on unmount", async () => {
    const { unmount } = render(<WorkspacePage />);
    await screen.findByText("Original message");

    const source = MockEventSource.instances[0];
    expect(source.closed).toBe(false);

    unmount();
    expect(source.closed).toBe(true);
  });
});
