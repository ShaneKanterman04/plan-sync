import type { Plan } from "@/lib/types";

export type PluginGateInput = {
  plan: Pick<
    Plan,
    | "bodyMd"
    | "status"
    | "version"
    | "approvedVersion"
    | "approvedBranch"
    | "approvedSha"
    | "approvedAt"
  >;
  staleReasons: string[];
  currentBranch?: string;
  currentSha?: string;
  inGitRepo?: boolean;
  strictApproval?: boolean;
};

export type PluginGateResult =
  | { ok: true }
  | { ok: false; code: 2 | 3; reason: string };

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function evaluatePluginGate(input: PluginGateInput): PluginGateResult {
  const { plan } = input;
  if (plan.status === "changes_requested") {
    return { ok: false, code: 2, reason: "changes requested" };
  }

  const strict = input.strictApproval ?? true;
  const problems: string[] = [];
  if (!plan.bodyMd.trim()) problems.push("plan body is empty");
  if (plan.version <= 0) problems.push("plan does not exist");
  if (plan.status !== "approved") problems.push(`status is ${plan.status}, not approved`);
  if (!plan.approvedAt) problems.push("approval timestamp is missing");
  if (plan.approvedVersion !== plan.version) {
    problems.push(
      `approved version ${plan.approvedVersion ?? "none"} != current version ${plan.version}`,
    );
  }
  if (input.staleReasons.length) problems.push(...input.staleReasons);
  if (strict && input.inGitRepo && !plan.approvedBranch) {
    problems.push("approved branch is missing");
  }
  if (strict && input.inGitRepo && !plan.approvedSha) {
    problems.push("approved SHA is missing");
  }
  if (plan.approvedBranch && input.currentBranch && plan.approvedBranch !== input.currentBranch) {
    problems.push(`current branch ${input.currentBranch} != approved branch ${plan.approvedBranch}`);
  }
  if (plan.approvedSha && input.currentSha && plan.approvedSha !== input.currentSha) {
    problems.push(`current SHA ${input.currentSha} != approved SHA ${plan.approvedSha}`);
  }
  if (problems.length) {
    return { ok: false, code: 3, reason: unique(problems).join("; ") };
  }
  return { ok: true };
}
