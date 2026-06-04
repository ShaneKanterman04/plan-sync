require("@testing-library/jest-dom");

// jsdom does not implement Element.scrollIntoView; stub it so components that
// auto-scroll (e.g. MessageThread) don't throw in tests. Individual tests can
// override this with a jest.fn() to assert scroll behavior.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Point the SQLite data dir at a clean, throwaway location for tests so the db
// module (imported by lib tests) never touches real app data.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const dir = path.join(os.tmpdir(), `plansync-test-${process.pid}`);
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
