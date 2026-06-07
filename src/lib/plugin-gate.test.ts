import { evaluatePluginGate } from "@/lib/plugin-gate";
import type { Plan } from "@/lib/types";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    workspace: "demo",
    title: "Demo",
    bodyMd: "# Plan",
    documentType: "plan",
    linkedFile: "",
    files: [],
    sourceBranch: "main",
    sourceSha: "abc123",
    referencedFiles: [],
    approvedVersion: 1,
    approvedBranch: "main",
    approvedSha: "abc123",
    approvedAt: "2026-06-04T00:00:00.000Z",
    status: "approved",
    version: 1,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    updatedBy: "human",
    ...overrides,
  };
}

function gate(overrides: Partial<Plan> = {}) {
  return evaluatePluginGate({
    plan: plan(overrides),
    staleReasons: [],
    currentBranch: "main",
    currentSha: "abc123",
    inGitRepo: true,
    strictApproval: true,
  });
}

describe("evaluatePluginGate", () => {
  test("allows a current approved plan", () => {
    expect(gate()).toEqual({ ok: true });
  });

  test("changes requested exits with code 2", () => {
    expect(gate({ status: "changes_requested" })).toEqual({
      ok: false,
      code: 2,
      reason: "changes requested",
    });
  });

  test("blocks stale approval versions", () => {
    const result = gate({ version: 2, approvedVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(3);
      expect(result.reason).toContain("approved version 1 != current version 2");
    }
  });

  test("blocks branch and SHA mismatches", () => {
    const result = evaluatePluginGate({
      plan: plan(),
      staleReasons: [],
      currentBranch: "feature",
      currentSha: "def456",
      inGitRepo: true,
      strictApproval: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("current branch feature != approved branch main");
      expect(result.reason).toContain("current SHA def456 != approved SHA abc123");
    }
  });

  test("strict mode blocks missing approval metadata in git repos", () => {
    const result = gate({ approvedBranch: "", approvedSha: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("approved branch is missing");
      expect(result.reason).toContain("approved SHA is missing");
    }
  });
});
