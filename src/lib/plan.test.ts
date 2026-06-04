import { assertTransition, canTransition } from "@/lib/schema";
import {
  addMessage,
  ensurePlan,
  getMessages,
  getPlan,
  getRevisions,
  pollSnapshot,
  putPlanBody,
  setStatus,
} from "@/lib/db";

describe("status transitions", () => {
  test("legal: draft → review", () => {
    expect(() => assertTransition("draft", "review")).not.toThrow();
    expect(canTransition("draft", "review")).toBe(true);
  });

  test("illegal: draft → done throws", () => {
    expect(() => assertTransition("draft", "done")).toThrow();
    expect(canTransition("draft", "done")).toBe(false);
  });

  test("same status is an idempotent no-op", () => {
    expect(canTransition("review", "review")).toBe(true);
  });

  test("the happy path is fully legal", () => {
    const path = ["draft", "review", "approved", "implementing", "done"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });
});

describe("plan data access", () => {
  test("putPlanBody bumps version and snapshots a revision", () => {
    const ws = "test-versions";
    ensurePlan(ws);
    const p1 = putPlanBody({ workspace: ws, title: "Caching", bodyMd: "# one", author: "agent" });
    expect(p1.version).toBe(1);
    expect(p1.title).toBe("Caching");

    const p2 = putPlanBody({ workspace: ws, bodyMd: "# two", author: "human" });
    expect(p2.version).toBe(2);
    expect(p2.updatedBy).toBe("human");
    expect(p2.title).toBe("Caching"); // title preserved when omitted

    const revs = getRevisions(ws);
    expect(revs.map((r) => r.version)).toEqual([2, 1]);
    expect(revs[0].bodyMd).toBe("# two");
  });

  test("putPlanBody upserts a brand-new workspace at version 1", () => {
    const ws = "test-fresh";
    const p = putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    expect(p.version).toBe(1);
    expect(p.status).toBe("draft");
  });

  test("setStatus enforces transitions and logs messages", () => {
    const ws = "test-status";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    setStatus({ workspace: ws, status: "review", author: "agent" });
    expect(getPlan(ws)!.status).toBe("review");

    expect(() => setStatus({ workspace: ws, status: "done", author: "human" })).toThrow();

    setStatus({ workspace: ws, status: "approved", author: "human", note: "lgtm" });
    expect(getPlan(ws)!.status).toBe("approved");
    const msgs = getMessages(ws);
    expect(msgs.some((m) => m.kind === "approve" && m.body === "lgtm")).toBe(true);
  });

  test("pollSnapshot reflects status, version, and messages", () => {
    const ws = "test-poll";
    putPlanBody({ workspace: ws, bodyMd: "x", author: "agent" });
    addMessage({ workspace: ws, author: "human", body: "hi" });
    const snap = pollSnapshot(ws)!;
    expect(snap.version).toBe(1);
    expect(snap.messageCount).toBe(1);
    expect(snap.lastMessageAt).not.toBeNull();
  });
});
