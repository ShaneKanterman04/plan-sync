import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message, Plan } from "@/lib/types";
import WorkspacePage from "./page";

let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useParams: () => ({ workspace: "demo" }),
  useSearchParams: () => searchParams,
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

const plan: Plan = {
  workspace: "demo",
  title: "Initial plan",
  bodyMd: "# Initial plan body",
  documentType: "plan",
  linkedFile: "docs/plan.md",
  files: [
    { path: "docs/plan.md", role: "sync" },
    { path: "src/app/page.tsx", role: "reference" },
  ],
  sourceBranch: "main",
  sourceSha: "abc123",
  referencedFiles: ["src/app/page.tsx"],
  approvedVersion: null,
  approvedBranch: "",
  approvedSha: "",
  approvedAt: null,
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

const updatedPlan: Plan = {
  ...plan,
  bodyMd: "# Updated plan body",
  version: 2,
  updatedAt: "2026-06-04T00:01:00.000Z",
};

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

function errorResponse(status: number, payload: unknown = {}): Response {
  return {
    ok: false,
    status,
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
    searchParams = new URLSearchParams();
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;

    fetchMock = jest.fn();
    // First GET returns the original thread; every later GET returns the updated one.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ plan, messages: firstMessages }))
      .mockResolvedValue(jsonResponse({ plan: updatedPlan, messages: secondMessages }));
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

  test("a 'changed' SSE event triggers an immediate load() and plan update", async () => {
    render(<WorkspacePage />);

    await screen.findByText("Original message");
    const callsAfterInitialLoad = fetchMock.mock.calls.length;
    expect(screen.queryByText("Pushed via SSE")).toBeNull();
    expect(screen.queryByText("# Updated plan body")).toBeNull();

    const source = MockEventSource.instances[0];

    const start = Date.now();
    await act(async () => {
      source.emit("changed");
    });

    // The event drove a refetch (load called again, no timer involved).
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(callsAfterInitialLoad + 1),
    );

    // New plan body and message appear as a direct result of the SSE event...
    await screen.findByText("# Updated plan body");
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

  test("falls back to 2s reloads when SSE disconnects", async () => {
    render(<WorkspacePage />);
    await screen.findByText("Original message");

    const source = MockEventSource.instances[0];
    act(() => {
      source.fail();
    });

    await screen.findByText(/Live updates disconnected from \/api\/w\/demo\/events\./);
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 2000)).toBe(true);
    expect(pollingTimerCalls(setIntervalSpy)).toHaveLength(0);
  });
});

describe("WorkspacePage file editing", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    MockEventSource.instances = [];
    searchParams = new URLSearchParams();
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;
    fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ plan, messages: firstMessages }))
      .mockResolvedValue(jsonResponse({ plan, messages: firstMessages }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("edits and saves multiple workspace files", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await screen.findByText("Original message");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("docs/plan.md")).toBeInTheDocument();
    expect(screen.getByDisplayValue("src/app/page.tsx")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add ref" }));
    const pathInputs = screen.getAllByPlaceholderText("docs/reports/example.md");
    await user.type(pathInputs[pathInputs.length - 1], "README.md");
    await user.click(screen.getByRole("button", { name: "Save edits" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/api/w/demo" && (init as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(true),
    );
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/w/demo" && (init as RequestInit | undefined)?.method === "PUT",
    );
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    expect(body.files).toEqual([
      { path: "docs/plan.md", role: "sync" },
      { path: "src/app/page.tsx", role: "reference" },
      { path: "README.md", role: "reference" },
    ]);
  });

  test("read-only mode hides editing controls", async () => {
    searchParams = new URLSearchParams("readonly=1");
    render(<WorkspacePage />);
    await screen.findByText("Original message");

    expect(screen.getByText("Read-only review mode. Editing, approval, and messages are disabled."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByLabelText("Upload files")).toBeNull();
  });

  test("uploads files and reloads the workspace", async () => {
    const user = userEvent.setup();
    fetchMock.mockReset();
    const uploadedPlan: Plan = {
      ...plan,
      files: [
        ...plan.files,
        { path: ".plan-sync/uploads/demo/report.csv", role: "reference" },
      ],
      referencedFiles: ["src/app/page.tsx", ".plan-sync/uploads/demo/report.csv"],
      version: 2,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ plan, messages: firstMessages }))
      .mockResolvedValueOnce(jsonResponse({ plan: uploadedPlan, uploaded: [] }))
      .mockResolvedValue(jsonResponse({ plan: uploadedPlan, messages: firstMessages }));

    render(<WorkspacePage />);
    await screen.findByText("Original message");

    await user.upload(
      screen.getByLabelText("Upload files"),
      new File(["name,value\nalpha,1\n"], "report.csv", { type: "text/csv" }),
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/api/w/demo/uploads" &&
            (init as RequestInit | undefined)?.method === "POST" &&
            (init as RequestInit | undefined)?.body instanceof FormData,
        ),
      ).toBe(true),
    );
    await screen.findByText("reference: .plan-sync/uploads/demo/report.csv");
  });

  test("upload failures show the error banner", async () => {
    const user = userEvent.setup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ plan, messages: firstMessages }))
      .mockResolvedValueOnce(errorResponse(400, { error: "upload failed on server" }))
      .mockResolvedValue(jsonResponse({ plan, messages: firstMessages }));

    render(<WorkspacePage />);
    await screen.findByText("Original message");

    await user.upload(
      screen.getByLabelText("Upload files"),
      new File(["name,value\n"], "report.csv", { type: "text/csv" }),
    );

    await screen.findByText("upload failed on server");
  });
});

describe("WorkspacePage sendMessage error handling", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    MockEventSource.instances = [];
    searchParams = new URLSearchParams();
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("sendMessage error shows in error banner and preserves textarea", async () => {
    const user = userEvent.setup();

    // 1) initial load succeeds, 2) POST /messages fails with 500,
    // 3) the reload that sendMessage attempts after the failure also fails 500.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ plan, messages: firstMessages }))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValue(errorResponse(500));

    render(<WorkspacePage />);

    // Wait for the initial successful load to render the plan + thread.
    await screen.findByText("Original message");
    const callsAfterInitialLoad = fetchMock.mock.calls.length;

    // Simulate the human sending a message.
    const textarea = screen.getByPlaceholderText("Reply to the agent…");
    await user.type(textarea, "please change the API");
    const sendButton = screen.getByRole("button", { name: "Send" });
    await user.click(sendButton);

    // 1) The error banner shows the failure message.
    await screen.findByText("Request failed.");

    // 3) The textarea draft is preserved so the human can retry.
    expect(textarea).toHaveValue("please change the API");

    // 4) The page attempted to POST and then reload after the failure.
    const posted = fetchMock.mock.calls.some(
      ([url, init]) =>
        url === "/api/w/demo/messages" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posted).toBe(true);
    // A subsequent reload GET to /api/w/demo was attempted (and also failed 500).
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(
        callsAfterInitialLoad + 1,
      ),
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/w/demo").length,
    ).toBeGreaterThan(1);

    // 2) The Send button returned to a non-busy state once the attempt settled.
    await waitFor(() => expect(sendButton).not.toBeDisabled());
  });
});
