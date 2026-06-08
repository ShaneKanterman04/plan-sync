import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeWorkspaceFilePath } from "@/lib/workspace-files";

export type UploadedWorkspaceFile = {
  originalName: string;
  path: string;
  size: number;
};

const allowedExtensions = new Set([".csv", ".txt", ".md", ".json", ".log"]);
const maxFileSize = 10 * 1024 * 1024;

function uploadRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.PLAN_UPLOAD_ROOT || ".plan-sync/uploads");
}

function workspaceRootForUpload(root: string): string {
  if (path.basename(root) === "uploads" && path.basename(path.dirname(root)) === ".plan-sync") {
    return path.dirname(path.dirname(root));
  }
  return path.dirname(root);
}

function safeFileName(name: string): string {
  const base = path.basename(name).trim();
  const ext = path.extname(base).toLowerCase();
  if (!allowedExtensions.has(ext)) {
    throw new Error(`unsupported upload file type: ${ext || "none"}`);
  }
  const stem = base.slice(0, -ext.length).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  const safeStem = stem || "upload";
  return `${safeStem.slice(0, 80)}${ext}`;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).name === "string" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).arrayBuffer === "function"
  );
}

export async function saveUploadedWorkspaceFiles(input: {
  workspace: string;
  formData: FormData;
}): Promise<UploadedWorkspaceFile[]> {
  const files = [...input.formData.getAll("files"), ...input.formData.getAll("file")].filter(
    isUploadFile,
  );
  if (files.length === 0) throw new Error("no upload files provided");
  if (files.length > 10) throw new Error("upload accepts at most 10 files");

  const root = uploadRoot();
  const workspaceRoot = workspaceRootForUpload(root);
  const workspaceDir = path.join(root, input.workspace);
  await mkdir(workspaceDir, { recursive: true });

  const uploaded: UploadedWorkspaceFile[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const file of files) {
    if (file.size <= 0) throw new Error(`upload file is empty: ${file.name || "unnamed"}`);
    if (file.size > maxFileSize) throw new Error(`upload file exceeds 10 MB: ${file.name}`);

    const fileName = `${stamp}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
    const destination = path.join(workspaceDir, fileName);
    const data = Buffer.from(await file.arrayBuffer());
    if (data.byteLength > maxFileSize) throw new Error(`upload file exceeds 10 MB: ${file.name}`);
    await writeFile(destination, data, { flag: "wx" });

    uploaded.push({
      originalName: file.name,
      path: normalizeWorkspaceFilePath(path.relative(workspaceRoot, destination)),
      size: data.byteLength,
    });
  }
  return uploaded;
}
