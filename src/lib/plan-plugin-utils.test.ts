/* eslint-disable @typescript-eslint/no-require-imports */
const {
  baselineFromBundle,
  listenEventForBundle,
  safeRelativePath,
  syncFileForPlan,
  workspaceFilesForPlan,
} = require("../../scripts/plan-plugin-utils.cjs");

function plan(overrides: Record<string, unknown> = {}) {
  return {
    workspace: "demo",
    linkedFile: "",
    status: "review",
    version: 1,
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    author: "human",
    kind: "note",
    body: "Please update the plan.",
    createdAt: "2026-06-05T00:00:00.000Z",
    ...overrides,
  };
}

function bundle({
  planOverrides = {},
  messages = [],
}: {
  planOverrides?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
} = {}) {
  return {
    plan: plan(planOverrides),
    messages,
    staleReasons: [],
  };
}

describe("plan plugin listen helpers", () => {
  test("uses plans/<workspace>.md when no linked file is set", () => {
    expect(syncFileForPlan(plan())).toEqual({
      ok: true,
      syncFile: "plans/demo.md",
    });
  });

  test("accepts safe relative linked files", () => {
    expect(syncFileForPlan(plan({ linkedFile: "docs/plan.md" }))).toEqual({
      ok: true,
      syncFile: "docs/plan.md",
    });
  });

  test("prefers the sync entry from plan.files", () => {
    const filePlan = plan({
      linkedFile: "docs/legacy.md",
      referencedFiles: ["README.md"],
      files: [
        { path: "docs/current.md", role: "sync" },
        { path: "src/app/page.tsx", role: "reference" },
      ],
    });
    expect(syncFileForPlan(filePlan)).toEqual({ ok: true, syncFile: "docs/current.md" });
    expect(workspaceFilesForPlan(filePlan)).toEqual([
      { path: "docs/current.md", role: "sync" },
      { path: "src/app/page.tsx", role: "reference" },
    ]);
  });

  test("rejects absolute and repo-escaping linked files", () => {
    expect(safeRelativePath("/tmp/plan.md")).toEqual({
      ok: false,
      reason: "workspace file must be relative: /tmp/plan.md",
    });
    expect(safeRelativePath("../plan.md")).toEqual({
      ok: false,
      reason: "workspace file escapes the repo: ../plan.md",
    });
  });

  test("returns a human_message event for new human notes only", () => {
    const initial = bundle({ messages: [message({ id: "old" })] });
    const baseline = baselineFromBundle(initial);
    const event = listenEventForBundle(
      bundle({
        messages: [
          message({ id: "old" }),
          message({ id: "agent", author: "agent" }),
          message({ id: "approval", kind: "approve" }),
          message({ id: "new", body: "Can you tighten the second step?" }),
        ],
      }),
      baseline,
    );

    expect(event.type).toBe("human_message");
    expect(event.syncFile).toBe("plans/demo.md");
    expect(event.messages.map((m: { id: string }) => m.id)).toEqual(["new"]);
  });

  test("returns sync_error when a new human note targets an unsafe linked file", () => {
    const initial = bundle({ planOverrides: { linkedFile: "../plan.md" } });
    const event = listenEventForBundle(
      bundle({
        planOverrides: { linkedFile: "../plan.md" },
        messages: [message({ id: "new" })],
      }),
      baselineFromBundle(initial),
    );

    expect(event.type).toBe("sync_error");
    expect(event.reason).toBe("workspace file escapes the repo: ../plan.md");
  });

  test("returns approval and changes-requested events", () => {
    const baseline = baselineFromBundle(bundle());
    expect(listenEventForBundle(bundle({ planOverrides: { status: "approved" } }), baseline).type)
      .toBe("approved");
    expect(
      listenEventForBundle(bundle({ planOverrides: { status: "changes_requested" } }), baseline)
        .type,
    ).toBe("changes_requested");
  });
});
