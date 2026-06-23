import { assertTransition, canTransition } from "@/lib/schema";
import {
  addMessage,
  appendProof,
  createPluginRun,
  createWebhook,
  db,
  deleteWebhook,
  ensurePlan,
  getAgentActivity,
  getMessages,
  getPlan,
  getPluginRun,
  getRevisions,
  listActiveWebhooks,
  listPluginRuns,
  listWebhooks,
  pollSnapshot,
  putPlanBody,
  setStatus,
  staleReasons,
  toggleReaction,
  updatePluginRun,
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

  test("putPlanBody stores document metadata and referenced files", () => {
    const ws = "test-metadata";
    const p = putPlanBody({
      workspace: ws,
      title: "Retrospective",
      bodyMd: "notes",
      author: "agent",
      documentType: "retrospective",
      linkedFile: "docs/report.md",
      sourceBranch: "main",
      sourceSha: "abc123",
      referencedFiles: ["src/app/page.tsx", "src/app/page.tsx", "README.md"],
    });

    expect(p.documentType).toBe("retrospective");
    expect(p.linkedFile).toBe("docs/report.md");
    expect(p.files).toEqual([
      { path: "docs/report.md", role: "sync" },
      { path: "README.md", role: "reference" },
      { path: "src/app/page.tsx", role: "reference" },
    ]);
    expect(p.sourceBranch).toBe("main");
    expect(p.sourceSha).toBe("abc123");
    expect(p.referencedFiles).toEqual(["README.md", "src/app/page.tsx"]);
  });

  test("putPlanBody stores explicit workspace files and legacy fields", () => {
    const ws = "test-files-explicit";
    const p = putPlanBody({
      workspace: ws,
      bodyMd: "plan",
      author: "agent",
      files: [
        { path: "docs/plan.md", role: "sync" },
        { path: "src/lib/db.ts", role: "reference" },
      ],
    });

    expect(p.linkedFile).toBe("docs/plan.md");
    expect(p.referencedFiles).toEqual(["src/lib/db.ts"]);
    expect(p.files).toEqual([
      { path: "docs/plan.md", role: "sync" },
      { path: "src/lib/db.ts", role: "reference" },
    ]);
    const row = db
      .prepare("SELECT linked_file, referenced_files FROM plans WHERE workspace = ?")
      .get(ws) as any;
    expect(row.linked_file).toBe("docs/plan.md");
    expect(JSON.parse(row.referenced_files)).toEqual(["src/lib/db.ts"]);
  });

  test("putPlanBody rejects unsafe and duplicate explicit workspace files", () => {
    expect(() =>
      putPlanBody({
        workspace: "test-files-unsafe",
        bodyMd: "plan",
        author: "agent",
        files: [{ path: "../plan.md", role: "sync" }],
      }),
    ).toThrow("escapes the repo");

    expect(() =>
      putPlanBody({
        workspace: "test-files-dupe",
        bodyMd: "plan",
        author: "agent",
        files: [
          { path: "docs/plan.md", role: "sync" },
          { path: "docs/plan.md", role: "reference" },
        ],
      }),
    ).toThrow("duplicate workspace file");
  });

  test("getPlan derives files from legacy columns when plan_files is empty", () => {
    const ws = "test-files-legacy";
    const at = new Date().toISOString();
    db.prepare(
      `INSERT INTO plans (
         workspace, title, body_md, document_type, linked_file, source_branch, source_sha,
         referenced_files, status, version, created_at, updated_at, updated_by
       ) VALUES (?, '', 'legacy', 'plan', 'docs/legacy.md', '', '', ?, 'draft', 1, ?, ?, 'agent')`,
    ).run(ws, JSON.stringify(["README.md"]), at, at);

    const p = getPlan(ws)!;
    expect(p.files).toEqual([
      { path: "docs/legacy.md", role: "sync" },
      { path: "README.md", role: "reference" },
    ]);
    expect(p.linkedFile).toBe("docs/legacy.md");
    expect(p.referencedFiles).toEqual(["README.md"]);
  });

  test("setStatus enforces transitions and logs messages", () => {
    const ws = "test-status";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    setStatus({ workspace: ws, status: "review", author: "agent" });
    expect(getPlan(ws)!.status).toBe("review");

    expect(() => setStatus({ workspace: ws, status: "done", author: "human" })).toThrow();

    setStatus({ workspace: ws, status: "approved", author: "human", note: "lgtm" });
    expect(getPlan(ws)!.status).toBe("approved");
    expect(getPlan(ws)!.approvedVersion).toBe(1);
    const msgs = getMessages(ws);
    expect(msgs.some((m) => m.kind === "approve" && m.body === "lgtm")).toBe(true);
  });

  test("staleReasons reports plan and git changes after approval", () => {
    const ws = "test-stale";
    putPlanBody({
      workspace: ws,
      bodyMd: "plan",
      author: "agent",
      sourceBranch: "main",
      sourceSha: "abc123",
    });
    setStatus({ workspace: ws, status: "review", author: "agent" });
    setStatus({ workspace: ws, status: "approved", author: "human" });
    const updated = putPlanBody({
      workspace: ws,
      bodyMd: "plan changed",
      author: "agent",
      sourceBranch: "staging",
      sourceSha: "def456",
    });

    expect(staleReasons(updated)).toEqual([
      "plan changed after approval: v1 → v2",
      "git SHA changed after approval: abc123 → def456",
      "git branch changed after approval: main → staging",
    ]);
  });

  test("appendProof adds a final proof section and proof message", () => {
    const ws = "test-proof";
    const before = putPlanBody({ workspace: ws, bodyMd: "# Plan", author: "agent" });
    const result = appendProof({
      workspace: ws,
      author: "agent",
      commits: ["abc123"],
      changedFiles: ["src/lib/db.ts"],
      validations: ["pnpm test"],
      runIds: ["12345"],
      notes: ["all green"],
    });

    expect(result.plan.version).toBe(before.version);
    expect(result.proofMd).toContain("## Final Proof");
    expect(result.proofMd).toContain("- abc123");
    expect(result.proofMd).toContain("- src/lib/db.ts");
    expect(result.proofMd).toContain("- pnpm test");
    expect(result.message.kind).toBe("proof");
    expect(result.message.body).toBe(result.proofMd);
  });

  test("plugin runs store agent and approval metadata", () => {
    const ws = "test-plugin-runs";
    putPlanBody({
      workspace: ws,
      bodyMd: "plan",
      author: "agent",
      sourceBranch: "main",
      sourceSha: "abc123",
    });
    setStatus({ workspace: ws, status: "review", author: "agent" });
    const approved = setStatus({ workspace: ws, status: "approved", author: "human" });

    const run = createPluginRun({
      id: "run-1",
      workspace: ws,
      agentName: "codex",
      state: "approved",
      planVersion: approved.version,
      approvedVersion: approved.approvedVersion,
      approvedBranch: approved.approvedBranch,
      approvedSha: approved.approvedSha,
      approvedAt: approved.approvedAt,
    });

    expect(run.agentName).toBe("codex");
    expect(run.state).toBe("approved");
    expect(run.approvedVersion).toBe(1);
    expect(getPluginRun(ws, "run-1")!.approvedSha).toBe("abc123");
    expect(listPluginRuns(ws).map((r) => r.id)).toEqual(["run-1"]);
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

describe("reactions", () => {
  test("toggleReaction adds on the first call and removes on the second", () => {
    const ws = "test-react-toggle";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    const msg = addMessage({ workspace: ws, author: "agent", body: "hello" });

    const on = toggleReaction({ workspace: ws, messageId: msg.id, emoji: "👍", author: "human" });
    expect(on.toggled).toBe("on");
    expect(on.reaction).not.toBeNull();
    expect(on.reaction!.emoji).toBe("👍");
    expect(on.reaction!.workspace).toBe(ws);

    const off = toggleReaction({ workspace: ws, messageId: msg.id, emoji: "👍", author: "human" });
    expect(off.toggled).toBe("off");
    expect(off.reaction).toBeNull();
  });

  test("getMessages aggregates a count across two authors reacting with the same emoji", () => {
    const ws = "test-react-count";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    const msg = addMessage({ workspace: ws, author: "agent", body: "review me" });

    toggleReaction({ workspace: ws, messageId: msg.id, emoji: "✅", author: "human" });
    toggleReaction({ workspace: ws, messageId: msg.id, emoji: "✅", author: "agent" });

    const [loaded] = getMessages(ws);
    const summary = loaded.reactions?.find((r) => r.emoji === "✅");
    expect(summary?.count).toBe(2);
  });

  test("getMessages flags mine only for the viewer's own reaction", () => {
    const ws = "test-react-mine";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    const msg = addMessage({ workspace: ws, author: "agent", body: "thoughts?" });

    toggleReaction({ workspace: ws, messageId: msg.id, emoji: "👀", author: "human" });
    toggleReaction({ workspace: ws, messageId: msg.id, emoji: "🎉", author: "agent" });

    const [asHuman] = getMessages(ws, undefined, "human");
    const humanEyes = asHuman.reactions?.find((r) => r.emoji === "👀");
    const humanParty = asHuman.reactions?.find((r) => r.emoji === "🎉");
    expect(humanEyes?.mine).toBe(true);
    expect(humanParty?.mine).toBe(false);
  });

  test("getMessages with a sinceIso filter still attaches reactions", () => {
    const ws = "test-react-since";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    const first = addMessage({ workspace: ws, author: "agent", body: "first" });
    const second = addMessage({ workspace: ws, author: "agent", body: "second" });
    toggleReaction({ workspace: ws, messageId: second.id, emoji: "👍", author: "human" });

    const recent = getMessages(ws, first.createdAt);
    const loaded = recent.find((m) => m.id === second.id);
    expect(loaded?.reactions?.find((r) => r.emoji === "👍")?.count).toBe(1);
  });

  test("getMessages without a viewer omits the mine flag", () => {
    const ws = "test-react-noviewer";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    const msg = addMessage({ workspace: ws, author: "agent", body: "anon" });
    toggleReaction({ workspace: ws, messageId: msg.id, emoji: "👍", author: "human" });

    const [loaded] = getMessages(ws);
    const summary = loaded.reactions?.find((r) => r.emoji === "👍");
    expect(summary?.count).toBe(1);
    expect(summary?.mine).toBeUndefined();
  });

  test("toggleReaction throws for an unknown message id", () => {
    const ws = "test-react-unknown";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    expect(() =>
      toggleReaction({ workspace: ws, messageId: "does-not-exist", emoji: "👍", author: "human" }),
    ).toThrow("message not found");
  });
});

describe("webhooks", () => {
  test("createWebhook stores a hook reflected by list and active list; deleteWebhook is idempotent", () => {
    const ws = "test-webhook-crud";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });

    const active = createWebhook({
      workspace: ws,
      url: "https://example.com/hook",
      events: ["plan", "status"],
      secret: "s3cret",
      active: true,
    });
    const inactive = createWebhook({
      workspace: ws,
      url: "https://example.com/off",
      events: ["message"],
      active: false,
    });

    expect(active.active).toBe(true);
    expect(active.events).toEqual(["plan", "status"]);
    expect(inactive.active).toBe(false);

    expect(listWebhooks(ws).map((w) => w.id).sort()).toEqual([active.id, inactive.id].sort());
    expect(listActiveWebhooks(ws).map((w) => w.id)).toEqual([active.id]);

    expect(deleteWebhook(ws, active.id)).toBe(true);
    expect(deleteWebhook(ws, active.id)).toBe(false);
    expect(listWebhooks(ws).map((w) => w.id)).toEqual([inactive.id]);
  });

  test("createWebhook enforces the per-workspace cap of 20", () => {
    const ws = "test-webhook-cap";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    for (let i = 0; i < 20; i++) {
      createWebhook({ workspace: ws, url: `https://example.com/${i}`, events: ["plan"] });
    }
    expect(() =>
      createWebhook({ workspace: ws, url: "https://example.com/21", events: ["plan"] }),
    ).toThrow(/webhook limit reached/);
  });

  test("webhookRow parses events, coerces active, and tolerates malformed JSON", () => {
    const ws = "test-webhook-rows";
    putPlanBody({ workspace: ws, bodyMd: "plan", author: "agent" });
    const at = new Date().toISOString();
    db.prepare(
      `INSERT INTO webhooks (id, workspace, url, secret, events, active, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
    ).run("wh-malformed", ws, "https://example.com/x", "not-json", 1, at, at);
    db.prepare(
      `INSERT INTO webhooks (id, workspace, url, secret, events, active, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
    ).run("wh-events", ws, "https://example.com/y", JSON.stringify(["plan", "proof", "bogus"]), 0, at, at);

    const hooks = listWebhooks(ws);
    const malformed = hooks.find((w) => w.id === "wh-malformed")!;
    const events = hooks.find((w) => w.id === "wh-events")!;
    expect(malformed.events).toEqual([]);
    expect(malformed.active).toBe(true);
    expect(events.events).toEqual(["plan", "proof"]);
    expect(events.active).toBe(false);
  });
});

describe("agent activity", () => {
  test("returns no activity for a workspace with no plan", () => {
    const activity = getAgentActivity("aa-missing");
    expect(activity).toEqual({
      at: null,
      source: null,
      liveState: null,
      agentName: null,
    });
  });

  test("derives the latest activity from the most recent agent artifact", () => {
    const ws = "aa-derive";
    const plan = putPlanBody({ workspace: ws, bodyMd: "# plan", author: "agent" });
    const message = addMessage({ workspace: ws, author: "agent", body: "on it" });

    const activity = getAgentActivity(ws);
    // The message was written after the plan, so it's the freshest signal.
    expect(activity.source).toBe("message");
    expect(activity.at).toBe(message.createdAt);
    expect(message.createdAt > plan.updatedAt).toBe(true);
    expect(activity.liveState).toBeNull();
  });

  test("ignores human-authored messages", () => {
    const ws = "aa-human";
    const plan = putPlanBody({ workspace: ws, bodyMd: "# plan", author: "agent" });
    addMessage({ workspace: ws, author: "human", body: "please change X" });

    const activity = getAgentActivity(ws);
    // The human reply is newer but doesn't count — the agent's plan write wins.
    expect(activity.source).toBe("plan");
    expect(activity.at).toBe(plan.updatedAt);
  });

  test("surfaces a live plugin run's state and agent name", () => {
    const ws = "aa-live";
    createPluginRun({ workspace: ws, agentName: "claude", state: "implementing" });

    const activity = getAgentActivity(ws);
    expect(activity.liveState).toBe("implementing");
    expect(activity.agentName).toBe("claude");
    expect(activity.source).toBe("run");
    expect(activity.at).not.toBeNull();
  });

  test("a finished run is not treated as live", () => {
    const ws = "aa-done";
    const run = createPluginRun({ workspace: ws, agentName: "claude", state: "implementing" });
    updatePluginRun({ workspace: ws, id: run.id, state: "done", endedAt: new Date().toISOString() });

    const activity = getAgentActivity(ws);
    expect(activity.liveState).toBeNull();
    expect(activity.agentName).toBeNull();
  });
});
