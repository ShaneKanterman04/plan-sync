import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceSummary } from "@/lib/types";
import Home from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// --- Mock EventSource ---------------------------------------------------------

type Listener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, Set<Listener>>();
  closed = false;
  onerror: ((event: Event) => void) | null = null;

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

  fail() {
    this.onerror?.(new Event("error"));
  }
}

// --- Fixtures -----------------------------------------------------------------

const first: WorkspaceSummary[] = [
  {
    workspace: "alpha",
    title: "Alpha plan",
    documentType: "plan",
    linkedFile: "",
    primaryFile: "",
    files: [],
    fileCount: 0,
    status: "review",
    version: 1,
    updatedBy: "agent",
    updatedAt: "2026-06-04T00:00:00.000Z",
    messageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    staleReasons: [],
  },
];

const second: WorkspaceSummary[] = [
  ...first,
  {
    workspace: "bravo",
    title: "Bravo plan",
    documentType: "summary",
    linkedFile: "docs/bravo.md",
    primaryFile: "docs/bravo.md",
    files: [{ path: "docs/bravo.md", role: "sync" }],
    fileCount: 1,
    status: "draft",
    version: 1,
    updatedBy: "agent",
    updatedAt: "2026-06-04T00:01:00.000Z",
    messageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    staleReasons: [],
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

describe("Home SSE wiring", () => {
  let fetchMock: jest.Mock;
  let setIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;

    fetchMock = jest.fn();
    // First GET returns one workspace; every later GET returns the updated list.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ workspaces: first }))
      .mockResolvedValue(jsonResponse({ workspaces: second }));
    global.fetch = fetchMock as unknown as typeof fetch;

    setIntervalSpy = jest.spyOn(global, "setInterval");
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    jest.clearAllMocks();
  });

  test("loads initially and opens an EventSource (no polling)", async () => {
    render(<Home />);

    // Initial load resolves the first workspace.
    await screen.findByText("alpha");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces",
      expect.any(Object),
    );

    // An EventSource was opened against the list events route.
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/workspaces/events");

    // Polling has been removed entirely: the component never starts the old 5s
    // refetch timer. (Test-framework timers may use setInterval, so we assert on
    // the 5000ms delay specifically rather than zero total calls.)
    expect(pollingTimerCalls(setIntervalSpy)).toHaveLength(0);
  });

  test("a 'changed' SSE event triggers an immediate load() and UI update", async () => {
    render(<Home />);

    await screen.findByText("alpha");
    const callsAfterInitialLoad = fetchMock.mock.calls.length;
    expect(screen.queryByText("bravo")).toBeNull();

    const source = MockEventSource.instances[0];

    const start = Date.now();
    await act(async () => {
      source.emit("changed");
    });

    // The event drove a refetch (load called again, no timer involved).
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(callsAfterInitialLoad + 1),
    );

    // New workspace appears as a direct result of the SSE event...
    await screen.findByText("bravo");
    // ...and well within 100ms (i.e. not waiting for any 5s poll).
    expect(Date.now() - start).toBeLessThan(100);

    expect(pollingTimerCalls(setIntervalSpy)).toHaveLength(0);
  });

  test("closes the EventSource on unmount", async () => {
    const { unmount } = render(<Home />);
    await screen.findByText("alpha");

    const source = MockEventSource.instances[0];
    expect(source.closed).toBe(false);

    unmount();
    expect(source.closed).toBe(true);
  });

  test("falls back to 2s reloads when SSE disconnects", async () => {
    render(<Home />);
    await screen.findByText("alpha");

    const source = MockEventSource.instances[0];
    act(() => {
      source.fail();
    });

    await screen.findByText(/Live updates disconnected from \/api\/workspaces\/events\./);
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 2000)).toBe(true);
    expect(pollingTimerCalls(setIntervalSpy)).toHaveLength(0);
  });
});
