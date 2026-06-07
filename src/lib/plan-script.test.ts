import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("skill plan script", () => {
  test("plan put emits files plus legacy fields", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plansync-script-"));
    try {
      const fakeBin = path.join(dir, "bin");
      const planFile = path.join(dir, "plan.md");
      const curlFile = path.join(fakeBin, "curl");
      mkdirSync(fakeBin);
      writeFileSync(planFile, "# Plan\n", "utf8");
      writeFileSync(
        curlFile,
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
      chmodSync(curlFile, 0o755);

      const result = spawnSync(
        "bash",
        [
          path.join(process.cwd(), "skill/plan-sync/scripts/plan"),
          "put",
          planFile,
          "--sync-file",
          "docs/plan.md",
          "--ref",
          "README.md",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            PLAN_WORKSPACE: "demo",
            PLAN_API_URL: "http://example.test",
            PATH: `${fakeBin}:${process.env.PATH}`,
          },
        },
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
});
