import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.join(process.cwd(), "skill/plan-sync/scripts/plan");

/** Build a temp dir with a fake curl that echoes the -d body (or '{}' if none). */
function makeFakeEnv(dir: string): { fakeBin: string; env: NodeJS.ProcessEnv } {
  const fakeBin = path.join(dir, "bin");
  mkdirSync(fakeBin);
  writeFileSync(
    path.join(fakeBin, "curl"),
    `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    shift
    printf '%s' "$1"
    exit 0
  fi
  shift
done
printf '{}'
`,
    "utf8",
  );
  chmodSync(path.join(fakeBin, "curl"), 0o755);
  return {
    fakeBin,
    env: {
      ...process.env,
      PLAN_WORKSPACE: "demo",
      PLAN_API_URL: "http://example.test",
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  };
}

describe("skill plan script", () => {
  test("plan put emits files plus legacy fields", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const planFile = path.join(dir, "plan.md");
      writeFileSync(planFile, "# Plan\n", "utf8");
      const { env } = makeFakeEnv(dir);

      const result = spawnSync(
        "bash",
        [SCRIPT, "put", planFile, "--sync-file", "docs/plan.md", "--ref", "README.md"],
        { cwd: process.cwd(), encoding: "utf8", env },
      );

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.linkedFile).toBe("docs/plan.md");
      expect(payload.referencedFiles).toEqual(["README.md"]);
      expect(payload.files).toEqual([
        { path: "docs/plan.md", role: "sync" },
        { path: "README.md", role: "reference" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan put --doc posts to /documents with slug + bodyMd (default title = slug)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const planFile = path.join(dir, "plan.md");
      writeFileSync(planFile, "# Plan\n", "utf8");
      const { env } = makeFakeEnv(dir);

      const result = spawnSync("bash", [SCRIPT, "put", planFile, "--doc", "retro-2026-06"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      });

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.author).toBe("agent");
      expect(payload.slug).toBe("retro-2026-06");
      expect(payload.title).toBe("retro-2026-06"); // default title = slug
      expect(payload.bodyMd).toBe("# Plan\n");
      // primary-plan fields must NOT be present in a doc POST
      expect(payload.linkedFile).toBeUndefined();
      expect(payload.referencedFiles).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan put --doc with explicit --title and --type", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const planFile = path.join(dir, "plan.md");
      writeFileSync(planFile, "body\n", "utf8");
      const { env } = makeFakeEnv(dir);

      const result = spawnSync(
        "bash",
        [SCRIPT, "put", planFile, "--doc", "sprint-1", "--title", "Sprint 1", "--type", "retrospective"],
        { cwd: process.cwd(), encoding: "utf8", env },
      );

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.slug).toBe("sprint-1");
      expect(payload.title).toBe("Sprint 1");
      expect(payload.documentType).toBe("retrospective");
      expect(payload.bodyMd).toBe("body\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan new <slug> posts to /documents with empty bodyMd (default title = slug)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const { env } = makeFakeEnv(dir);

      const result = spawnSync("bash", [SCRIPT, "new", "my-doc", "--title", "My Doc", "--type", "plan"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
        input: "", // no stdin
      });

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.author).toBe("agent");
      expect(payload.slug).toBe("my-doc");
      expect(payload.title).toBe("My Doc");
      expect(payload.documentType).toBe("plan");
      expect(payload.bodyMd).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan new <slug> with --file reads file content", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const bodyFile = path.join(dir, "body.md");
      writeFileSync(bodyFile, "doc content\n", "utf8");
      const { env } = makeFakeEnv(dir);

      const result = spawnSync("bash", [SCRIPT, "new", "my-doc", "--file", bodyFile], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
        input: "",
      });

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.slug).toBe("my-doc");
      expect(payload.bodyMd).toBe("doc content\n");
      expect(payload.title).toBe("my-doc"); // default
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan msg --doc routes to /d/<slug>/messages", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const { env } = makeFakeEnv(dir);

      const result = spawnSync("bash", [SCRIPT, "msg", "--doc", "retro-2026-06", "Hello world"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      });

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.author).toBe("agent");
      expect(payload.kind).toBe("note"); // default kind
      expect(payload.body).toBe("Hello world");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan msg without --doc still routes to primary /messages", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const { env } = makeFakeEnv(dir);

      const result = spawnSync("bash", [SCRIPT, "msg", "--kind", "progress", "Still going"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      });

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.author).toBe("agent");
      expect(payload.kind).toBe("progress");
      expect(payload.body).toBe("Still going");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
