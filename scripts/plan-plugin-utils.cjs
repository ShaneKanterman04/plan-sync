/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

function safeRelativePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, reason: "path is empty" };
  if (path.isAbsolute(raw)) {
    return { ok: false, reason: `linked file must be relative: ${raw}` };
  }
  const normalized = path.normalize(raw).replace(/\\/g, "/");
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return { ok: false, reason: `linked file escapes the repo: ${raw}` };
  }
  return { ok: true, path: normalized };
}

function syncFileForPlan(plan) {
  const linkedFile = String(plan?.linkedFile || "").trim();
  const candidate = linkedFile || `plans/${plan.workspace}.md`;
  const safe = safeRelativePath(candidate);
  if (!safe.ok) {
    return { ok: false, reason: safe.reason, syncFile: candidate };
  }
  return { ok: true, syncFile: safe.path };
}

function baselineFromBundle(bundle) {
  return {
    status: bundle.plan.status,
    version: bundle.plan.version,
    messageIds: new Set((bundle.messages || []).map((message) => message.id)),
  };
}

function newHumanNotes(bundle, baseline) {
  const seen = baseline?.messageIds || new Set();
  return (bundle.messages || []).filter(
    (message) => !seen.has(message.id) && message.author === "human" && message.kind === "note",
  );
}

function listenEventForBundle(bundle, baseline) {
  const messages = newHumanNotes(bundle, baseline);
  if (messages.length) {
    const sync = syncFileForPlan(bundle.plan);
    if (!sync.ok) {
      return {
        type: "sync_error",
        workspace: bundle.plan.workspace,
        plan: bundle.plan,
        messages,
        syncFile: sync.syncFile,
        reason: sync.reason,
      };
    }
    return {
      type: "human_message",
      workspace: bundle.plan.workspace,
      plan: bundle.plan,
      messages,
      syncFile: sync.syncFile,
    };
  }

  if (bundle.plan.status === "changes_requested") {
    return {
      type: "changes_requested",
      workspace: bundle.plan.workspace,
      plan: bundle.plan,
      messages: bundle.messages || [],
    };
  }

  if (bundle.plan.status === "approved") {
    return {
      type: "approved",
      workspace: bundle.plan.workspace,
      plan: bundle.plan,
      messages: bundle.messages || [],
    };
  }

  return null;
}

module.exports = {
  baselineFromBundle,
  listenEventForBundle,
  newHumanNotes,
  safeRelativePath,
  syncFileForPlan,
};
