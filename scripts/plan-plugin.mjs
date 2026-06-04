#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoCwd = process.env.PLAN_REPO_CWD || process.cwd();
const baseUrl = (process.env.PLAN_API_URL || "http://localhost:3000").replace(/\/$/, "");
const workspace = process.env.PLAN_WORKSPACE || "";
const token = process.env.PLAN_API_TOKEN || "";
const agentName = process.env.PLAN_AGENT_NAME || "codex";
const pollInterval = Number(process.env.PLAN_PLUGIN_POLL_INTERVAL || 3);
const defaultTimeout = Number(process.env.PLAN_PLUGIN_TIMEOUT || 600);
const strictApproval = process.env.PLAN_APPROVAL_STRICT !== "0";

function usage() {
  console.error(`usage:
  plan plugin wait [--timeout 600] [--interval 3]
  plan plugin preflight
  plan plugin run-codex
  plan plugin daemon`);
  process.exit(1);
}

function needWorkspace() {
  if (!workspace) {
    throw new Error("PLAN_WORKSPACE is required.");
  }
}

async function api(method, suffix, body) {
  needWorkspace();
  const res = await fetch(`${baseUrl}/api/w/${encodeURIComponent(workspace)}${suffix}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { error: text };
        }
      })()
    : {};
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function postMessage(kind, body) {
  await api("POST", "/messages", { author: "agent", kind, body });
}

async function setStatus(status, note) {
  await api("PATCH", "/status", { author: "agent", status, note });
}

async function createRun(state, bundle) {
  const runId = `${agentName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await api("POST", "/plugin-runs", {
    id: runId,
    agentName,
    state,
    planVersion: bundle?.plan.version ?? null,
    approvedVersion: bundle?.plan.approvedVersion ?? null,
    approvedBranch: bundle?.plan.approvedBranch ?? "",
    approvedSha: bundle?.plan.approvedSha ?? "",
    approvedAt: bundle?.plan.approvedAt ?? null,
  });
  return runId;
}

async function updateRun(id, patch) {
  await api("PATCH", "/plugin-runs", { id, ...patch });
}

async function getBundle() {
  return api("GET", "/export?format=json");
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoCwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function currentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function currentSha() {
  return git(["rev-parse", "--short=12", "HEAD"]);
}

function fullSha() {
  return git(["rev-parse", "HEAD"]);
}

function inGitRepo() {
  return Boolean(git(["rev-parse", "--show-toplevel"]));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function evaluatePluginGate({ plan, staleReasons, branch, sha, repo }) {
  if (plan.status === "changes_requested") {
    return { ok: false, code: 2, reason: "changes requested" };
  }
  const problems = [];
  if (!plan.bodyMd.trim()) problems.push("plan body is empty");
  if (plan.version <= 0) problems.push("plan does not exist");
  if (plan.status !== "approved") problems.push(`status is ${plan.status}, not approved`);
  if (!plan.approvedAt) problems.push("approval timestamp is missing");
  if (plan.approvedVersion !== plan.version) {
    problems.push(
      `approved version ${plan.approvedVersion ?? "none"} != current version ${plan.version}`,
    );
  }
  if (staleReasons.length) problems.push(...staleReasons);
  if (strictApproval && repo && !plan.approvedBranch) problems.push("approved branch is missing");
  if (strictApproval && repo && !plan.approvedSha) problems.push("approved SHA is missing");
  if (plan.approvedBranch && branch && plan.approvedBranch !== branch) {
    problems.push(`current branch ${branch} != approved branch ${plan.approvedBranch}`);
  }
  if (plan.approvedSha && sha && plan.approvedSha !== sha) {
    problems.push(`current SHA ${sha} != approved SHA ${plan.approvedSha}`);
  }
  if (problems.length) {
    return { ok: false, code: 3, reason: unique(problems).join("; ") };
  }
  return { ok: true };
}

function validateGate(bundle) {
  const result = evaluatePluginGate({
    plan: bundle.plan,
    staleReasons: bundle.staleReasons,
    branch: currentBranch(),
    sha: currentSha(),
    repo: inGitRepo(),
  });
  return result.ok ? { ok: true, bundle } : { ...result, bundle };
}

async function gate() {
  return validateGate(await getBundle());
}

function runShell(command) {
  if (!command.trim()) return { code: 0, output: "" };
  const result = spawnSync(command, {
    cwd: repoCwd,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

async function runPreflight() {
  const gated = await gate();
  if (!gated.ok) {
    await postMessage("check", `Preflight blocked: ${gated.reason}`);
    const status = gated.bundle?.plan.status;
    if (gated.code === 3 && ["review", "approved", "implementing"].includes(status || "")) {
      await setStatus("changes_requested", `Preflight blocked: ${gated.reason}`);
    }
    return gated;
  }
  const missing = gated.bundle.plan.referencedFiles.filter((file) => !existsSync(path.join(repoCwd, file)));
  const problems = missing.length ? [`missing referenced files: ${missing.join(", ")}`] : [];
  const command = process.env.PLAN_PREFLIGHT_CMD || "";
  const preflight = runShell(command);
  if (preflight.code !== 0) {
    problems.push(`preflight command failed (${command}): ${preflight.output || `exit ${preflight.code}`}`);
  }
  if (problems.length) {
    const reason = unique(problems).join("; ");
    await postMessage("check", `Preflight failed: ${reason}`);
    await setStatus("changes_requested", `Preflight failed: ${reason}`);
    return { ok: false, code: 3, reason, bundle: gated.bundle };
  }
  const summary = [
    `Preflight OK: ${gated.bundle.plan.referencedFiles.length} referenced files checked`,
    `branch=${currentBranch() || "unknown"}`,
    `sha=${currentSha() || "unknown"}`,
    command ? `command=${command}` : "",
  ].filter(Boolean).join("; ");
  await postMessage("check", summary);
  return gated;
}

async function waitForApproval(timeoutSeconds, intervalSeconds) {
  const runId = await createRun("waiting");
  const started = Date.now();
  while (true) {
    const bundle = await getBundle();
    const version = bundle.plan.version;
    const status = bundle.plan.status;
    console.error(`plan-sync: status=${status} version=${version}`);
    if (status === "approved") {
      const result = validateGate(bundle);
      if (!result.ok) {
        await postMessage("progress", `Plugin blocked: ${result.reason}`);
        await updateRun(runId, {
          state: "failed",
          endedAt: new Date().toISOString(),
          exitCode: result.code,
          errorText: result.reason,
        });
        return result.code;
      }
      await updateRun(runId, {
        state: "approved",
        planVersion: bundle.plan.version,
        approvedVersion: bundle.plan.approvedVersion,
        approvedBranch: bundle.plan.approvedBranch,
        approvedSha: bundle.plan.approvedSha,
        approvedAt: bundle.plan.approvedAt,
      });
      return 0;
    }
    if (status === "changes_requested") {
      const reason = "changes requested";
      await postMessage("progress", `Plugin blocked: ${reason}`);
      await updateRun(runId, {
        state: "failed",
        endedAt: new Date().toISOString(),
        exitCode: 2,
        errorText: reason,
      });
      return 2;
    }
    if ((Date.now() - started) / 1000 >= timeoutSeconds) {
      const reason = `timed out waiting for approval after ${timeoutSeconds}s`;
      await postMessage("progress", `Plugin blocked: ${reason}`);
      await updateRun(runId, { state: "failed", endedAt: new Date().toISOString(), exitCode: 124, errorText: reason });
      return 124;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

function promptFor(planPath) {
  return `You are running under the mandatory plan-sync plugin.

Approved plan file:
${planPath}

Rules:
- Implement only the approved plan.
- Do not expand scope.
- Do not start unrelated refactors.
- Before editing, inspect referenced files.
- Use ./scripts/plan msg --kind progress to report progress.
- If blocked, stop and report through ./scripts/plan msg.
- If the plan appears stale or incorrect, stop. Do not improvise.
- Run validation before finishing.
- Do not mark the task done yourself unless validation passes.
`;
}

function exportApprovedPlan(bundle) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plan-sync-"));
  const file = path.join(dir, `approved-plan-v${bundle.plan.version}.md`);
  const lines = [
    `# ${bundle.plan.title || bundle.plan.workspace}`,
    "",
    "## Metadata",
    "",
    `- Workspace: ${bundle.plan.workspace}`,
    `- Status: ${bundle.plan.status}`,
    `- Version: ${bundle.plan.version}`,
    `- Approved version: ${bundle.plan.approvedVersion}`,
    `- Approved at: ${bundle.plan.approvedAt}`,
    `- Approved branch: ${bundle.plan.approvedBranch || "unknown"}`,
    `- Approved SHA: ${bundle.plan.approvedSha || "unknown"}`,
  ];
  if (bundle.plan.referencedFiles.length) {
    lines.push("", "## Referenced Files", "", ...bundle.plan.referencedFiles.map((file) => `- ${file}`));
  }
  lines.push("", "## Approved Plan", "", bundle.plan.bodyMd);
  writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

async function monitor(child, approvedVersion) {
  while (child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
    let bundle;
    try {
      bundle = await getBundle();
    } catch (error) {
      const message = error instanceof Error ? error.message : "API failure";
      await postMessage("progress", `Plugin interrupting Codex: ${message}`);
      child.kill("SIGINT");
      return message;
    }
    if (bundle.plan.status === "changes_requested") {
      const reason = "human requested changes during implementation";
      await postMessage("progress", `Plugin interrupting Codex: ${reason}`);
      child.kill("SIGINT");
      return reason;
    }
    if (bundle.plan.version !== approvedVersion) {
      const reason = `plan changed during implementation: v${approvedVersion} -> v${bundle.plan.version}`;
      await postMessage("progress", `Plugin interrupting Codex: ${reason}`);
      child.kill("SIGINT");
      return reason;
    }
  }
  return "";
}

function changedFiles() {
  const result = spawnSync("git", ["status", "--short"], { cwd: repoCwd, encoding: "utf8" });
  if (result.status !== 0) return [];
  return unique(
    result.stdout
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean),
  );
}

async function runCodex() {
  const runId = await createRun("waiting");
  try {
    await updateRun(runId, { state: "preflight" });
    const preflight = await runPreflight();
    if (!preflight.ok) {
      await updateRun(runId, { state: "failed", endedAt: new Date().toISOString(), exitCode: preflight.code, errorText: preflight.reason });
      return preflight.code;
    }
    const approvedPlanPath = exportApprovedPlan(preflight.bundle);
    await updateRun(runId, {
      state: "implementing",
      planVersion: preflight.bundle.plan.version,
      approvedVersion: preflight.bundle.plan.approvedVersion,
      approvedBranch: preflight.bundle.plan.approvedBranch,
      approvedSha: preflight.bundle.plan.approvedSha,
      approvedAt: preflight.bundle.plan.approvedAt,
    });
    await setStatus("implementing", `Plugin ${runId} started ${agentName}.`);
    await postMessage("progress", `Plugin launching ${agentName} with approved plan v${preflight.bundle.plan.version}.`);

    const command = process.env.PLAN_AGENT_CMD || "codex exec";
    const child = spawn(command, {
      cwd: repoCwd,
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, PLAN_APPROVED_PLAN_PATH: approvedPlanPath, PLAN_PLUGIN_RUN_ID: runId },
    });
    const exitPromise = new Promise((resolve) =>
      child.once("exit", (exitCode) => resolve(exitCode ?? 1)),
    );
    child.stdin.end(promptFor(approvedPlanPath));
    const interruption = await monitor(child, preflight.bundle.plan.version);
    const code = await exitPromise;
    if (interruption) {
      await updateRun(runId, { state: "interrupted", endedAt: new Date().toISOString(), exitCode: code || 1, errorText: interruption });
      return code || 1;
    }
    if (code !== 0) {
      const reason = `${agentName} exited with code ${code}`;
      await postMessage("progress", reason);
      await updateRun(runId, { state: "failed", endedAt: new Date().toISOString(), exitCode: code, errorText: reason });
      return code;
    }

    const validateCommand = process.env.PLAN_VALIDATE_CMD || "";
    const validation = runShell(validateCommand);
    if (validation.code !== 0) {
      const reason = `validation failed (${validateCommand}): ${validation.output || `exit ${validation.code}`}`;
      await postMessage("check", reason);
      await updateRun(runId, { state: "failed", endedAt: new Date().toISOString(), exitCode: validation.code, errorText: reason });
      return validation.code || 1;
    }
    const validations = validateCommand
      ? [`${validateCommand} passed${validation.output ? `: ${validation.output.slice(0, 220)}` : ""}`]
      : ["No PLAN_VALIDATE_CMD configured."];
    await api("POST", "/proof", {
      author: "agent",
      commits: [fullSha()].filter(Boolean),
      changedFiles: changedFiles(),
      validations,
      runIds: [runId],
      notes: [`Agent: ${agentName}`],
    });
    await setStatus("done", `Plugin ${runId} completed after validation.`);
    await updateRun(runId, { state: "done", endedAt: new Date().toISOString(), exitCode: 0 });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Plugin failure";
    await postMessage("progress", `Plugin failed: ${message}`).catch(() => undefined);
    await updateRun(runId, { state: "failed", endedAt: new Date().toISOString(), exitCode: 1, errorText: message }).catch(() => undefined);
    return 1;
  }
}

async function daemon() {
  while (true) {
    const code = await waitForApproval(defaultTimeout, pollInterval);
    if (code === 0) {
      const runCode = await runCodex();
      if (runCode !== 0) return runCode;
    } else if (code === 2 || code === 3 || code === 124) {
      return code;
    } else {
      return code || 1;
    }
  }
}

async function main() {
  const [group, subcommand, ...rest] = process.argv.slice(2);
  if (group !== "plugin") usage();
  if (subcommand === "wait") {
    let timeout = defaultTimeout;
    let interval = pollInterval;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--timeout") timeout = Number(rest[++i] || timeout);
      else if (rest[i] === "--interval") interval = Number(rest[++i] || interval);
    }
    process.exit(await waitForApproval(timeout, interval));
  }
  if (subcommand === "preflight") {
    const result = await runPreflight();
    process.exit(result.ok ? 0 : result.code);
  }
  if (subcommand === "run-codex") {
    process.exit(await runCodex());
  }
  if (subcommand === "daemon") {
    process.exit(await daemon());
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
