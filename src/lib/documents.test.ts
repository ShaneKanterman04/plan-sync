import {
  addDocumentMessage,
  archiveDocument,
  deleteDocument,
  getDocument,
  getDocumentBySlug,
  getDocumentMessages,
  listExtraDocuments,
  listWorkspaceDocuments,
  putDocument,
  putPlanBody,
  PRIMARY_DOC_ID,
} from "@/lib/db";

describe("documents data layer", () => {
  test("putDocument creates v1, re-publishing the same slug updates in place", () => {
    const ws = "docs-create";
    const a = putDocument({ workspace: ws, title: "Status Report", bodyMd: "# hi", author: "agent" });
    expect(a.version).toBe(1);
    expect(a.slug).toBe("status-report");
    expect(a.isPrimary).toBe(false);
    expect(a.documentType).toBe("summary");

    const b = putDocument({ workspace: ws, slug: "status-report", title: "Status Report", bodyMd: "# updated", author: "agent" });
    expect(b.docId).toBe(a.docId); // same slug → same doc
    expect(b.version).toBe(2);
    expect(b.bodyMd).toBe("# updated");
    expect(listExtraDocuments(ws)).toHaveLength(1);
  });

  test("explicit docId targets a specific document", () => {
    const ws = "docs-id";
    const a = putDocument({ workspace: ws, title: "First", bodyMd: "1", author: "agent" });
    const b = putDocument({ workspace: ws, docId: a.docId, title: "First (edited)", bodyMd: "2", author: "human" });
    expect(b.docId).toBe(a.docId);
    expect(b.title).toBe("First (edited)");
    expect(b.version).toBe(2);
    expect(getDocument(ws, a.docId)?.bodyMd).toBe("2");
  });

  test("getDocumentBySlug + distinct slugs are distinct documents", () => {
    const ws = "docs-slug";
    putDocument({ workspace: ws, title: "Alpha", bodyMd: "a", author: "agent" });
    putDocument({ workspace: ws, title: "Beta", bodyMd: "b", author: "agent" });
    expect(getDocumentBySlug(ws, "alpha")?.title).toBe("Alpha");
    expect(getDocumentBySlug(ws, "beta")?.title).toBe("Beta");
    expect(listExtraDocuments(ws)).toHaveLength(2);
  });

  test("archive hides from the default list, includeArchived shows it; delete removes it", () => {
    const ws = "docs-archive";
    const doc = putDocument({ workspace: ws, title: "Old", bodyMd: "x", author: "agent" });
    expect(archiveDocument(ws, doc.docId, true)?.archived).toBe(true);
    expect(listExtraDocuments(ws)).toHaveLength(0);
    expect(listExtraDocuments(ws, true)).toHaveLength(1);
    expect(archiveDocument(ws, doc.docId, false)?.archived).toBe(false);
    expect(listExtraDocuments(ws)).toHaveLength(1);
    expect(deleteDocument(ws, doc.docId)).toBe(true);
    expect(getDocument(ws, doc.docId)).toBeNull();
  });

  test("listWorkspaceDocuments pins the primary plan first, then extras", () => {
    const ws = "docs-unified";
    putPlanBody({ workspace: ws, title: "The Plan", bodyMd: "plan body", author: "agent" });
    putDocument({ workspace: ws, title: "Extra Doc", bodyMd: "extra", author: "agent" });
    const list = listWorkspaceDocuments(ws);
    expect(list).toHaveLength(2);
    expect(list[0].isPrimary).toBe(true);
    expect(list[0].docId).toBe(PRIMARY_DOC_ID);
    expect(list[0].title).toBe("The Plan");
    expect(list[0].status).not.toBeNull();
    expect(list[1].isPrimary).toBe(false);
    expect(list[1].title).toBe("Extra Doc");
    expect(list[1].status).toBeNull();
  });

  test("a workspace with only extra docs (no plan) lists just the extras", () => {
    const ws = "docs-noplan";
    putDocument({ workspace: ws, title: "Only Doc", bodyMd: "z", author: "agent" });
    const list = listWorkspaceDocuments(ws);
    expect(list).toHaveLength(1);
    expect(list[0].isPrimary).toBe(false);
  });

  test("document messages: add + read; unknown doc throws", () => {
    const ws = "docs-msg";
    const doc = putDocument({ workspace: ws, title: "Discussable", bodyMd: "d", author: "agent" });
    addDocumentMessage({ workspace: ws, docId: doc.docId, author: "human", body: "looks good" });
    const msgs = getDocumentMessages(ws, doc.docId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe("looks good");
    expect(msgs[0].author).toBe("human");
    expect(() =>
      addDocumentMessage({ workspace: ws, docId: "nope", author: "agent", body: "x" }),
    ).toThrow("document not found");
    expect(listWorkspaceDocuments(ws)[0].messageCount).toBe(1);
  });
});
