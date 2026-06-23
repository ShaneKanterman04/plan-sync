import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    agentActivity: { at: "2026-06-04T00:00:00.000Z", source: "plan", liveState: null, agentName: null },
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
    agentActivity: { at: "2026-06-04T00:01:00.000Z", source: "document", liveState: null, agentName: null },
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

  test("mounts the theme toggle in the header", async () => {
    render(<Home />);
    await screen.findByText("alpha");

    // Segmented Light / Auto / Dark control from ThemeToggle.
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });
});

// --- Unread badge -------------------------------------------------------------

// A workspace with messages, used only by the unread-badge tests so the SSE
// fixtures above stay untouched.
const withMessages: WorkspaceSummary[] = [
  {
    workspace: "charlie",
    title: "Charlie plan",
    documentType: "plan",
    linkedFile: "",
    primaryFile: "",
    files: [],
    fileCount: 0,
    status: "review",
    version: 2,
    updatedBy: "agent",
    updatedAt: "2026-06-04T00:02:00.000Z",
    messageCount: 4,
    lastMessageAt: "2026-06-04T00:02:00.000Z",
    lastMessagePreview: "needs another look",
    staleReasons: [],
    agentActivity: { at: "2026-06-04T00:02:00.000Z", source: "message", liveState: null, agentName: null },
  },
];

describe("Home unread badge", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;

    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({ workspaces: withMessages }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test("shows an unread badge when messageCount exceeds the seen count", async () => {
    // Seen 1 of 4 messages → 3 unread.
    localStorage.setItem(
      "plansync:lastSeen:charlie",
      JSON.stringify({ at: "2026-06-04T00:00:30.000Z", count: 1 }),
    );

    render(<Home />);
    await screen.findByText("charlie");

    const badge = await screen.findByLabelText("3 unread messages");
    expect(badge).toHaveTextContent("3");
  });

  test("hides the unread badge when the seen count matches messageCount", async () => {
    // Already seen all 4 messages → no unread badge.
    localStorage.setItem(
      "plansync:lastSeen:charlie",
      JSON.stringify({ at: "2026-06-04T00:02:00.000Z", count: 4 }),
    );

    render(<Home />);
    // Workspace name still renders (getByText must keep working).
    await screen.findByText("charlie");

    expect(screen.queryByLabelText(/unread message/)).toBeNull();
  });
});
