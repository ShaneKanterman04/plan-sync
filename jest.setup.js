require("@testing-library/jest-dom");

// Point the SQLite data dir at a clean, throwaway location for tests so the db
// module (imported by lib tests) never touches real app data.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const dir = path.join(os.tmpdir(), `plansync-test-${process.pid}`);
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
