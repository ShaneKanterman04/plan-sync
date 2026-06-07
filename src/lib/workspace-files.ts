import path from "node:path";
import type { WorkspaceFile, WorkspaceFileRole } from "@/lib/types";

export type WorkspaceFileInput = {
  path: string;
  role: WorkspaceFileRole;
};

export function normalizeWorkspaceFilePath(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("workspace file path is empty");
  if (raw.length > 500) throw new Error(`workspace file path is too long: ${raw.slice(0, 80)}`);
  if (raw.includes("\0")) throw new Error("workspace file path contains an invalid character");
  if (path.isAbsolute(raw)) throw new Error(`workspace file path must be relative: ${raw}`);

  const normalized = path.normalize(raw).replace(/\\/g, "/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`workspace file path escapes the repo: ${raw}`);
  }
  return normalized;
}

export function normalizeWorkspaceFiles(
  files: WorkspaceFileInput[],
  options: { rejectDuplicates?: boolean } = {},
): WorkspaceFile[] {
  const rejectDuplicates = options.rejectDuplicates ?? true;
  if (files.length > 200) throw new Error("workspace files must contain at most 200 entries");

  const normalized: WorkspaceFile[] = [];
  const seen = new Set<string>();
  let syncCount = 0;
  for (const file of files) {
    const role = file.role;
    if (role !== "sync" && role !== "reference") {
      throw new Error(`invalid workspace file role: ${String(role)}`);
    }
    const filePath = normalizeWorkspaceFilePath(file.path);
    if (seen.has(filePath)) {
      if (rejectDuplicates) throw new Error(`duplicate workspace file: ${filePath}`);
      continue;
    }
    seen.add(filePath);
    if (role === "sync") syncCount += 1;
    if (syncCount > 1) throw new Error("workspace files may include only one sync file");
    normalized.push({ path: filePath, role });
  }
  return normalized;
}

export function workspaceFilesFromLegacy(input: {
  linkedFile?: string;
  referencedFiles?: string[];
}): WorkspaceFile[] {
  const files: WorkspaceFileInput[] = [];
  if (input.linkedFile?.trim()) files.push({ path: input.linkedFile, role: "sync" });
  for (const file of input.referencedFiles ?? []) {
    if (file.trim()) files.push({ path: file, role: "reference" });
  }
  return normalizeWorkspaceFiles(files, { rejectDuplicates: false });
}

export function syncFileFromFiles(files: WorkspaceFile[]): string {
  return files.find((file) => file.role === "sync")?.path ?? "";
}

export function referenceFilesFromFiles(files: WorkspaceFile[]): string[] {
  return files.filter((file) => file.role === "reference").map((file) => file.path);
}
