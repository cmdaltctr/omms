import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "omms-cleanup-records-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = home;
process.env.USERPROFILE = home;

const { CONFIG } = await import("../src/config.js");
const storage = join(home, "data");
const oldStorage = CONFIG.storagePath;
CONFIG.storagePath = storage;

const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { CleanupService } = await import("../src/services/cleanup-service.js");
const records = await import("../src/services/user-profile/auto-cleanup-store.js");

afterAll(async () => {
  await tursoConnectionManager.closeAll();
  CONFIG.storagePath = oldStorage;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  rmSync(home, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const input = { promptsAnalyzed: 100, merged: 1, removed: 0, entries: [] };

async function count() {
  const db = await tursoConnectionManager.getConnection(join(storage, "user-profiles.db"));
  const row = await db.get("SELECT COUNT(*) AS n FROM profile_auto_cleanups");
  return Number(row?.n);
}

describe("cleanup run and the automatic cleanup restore records", () => {
  it("deletes records older than 30 days, with no other access to the table", async () => {
    const now = Date.now();
    // Each insert prunes relative to its own timestamp, so these three rows all stay.
    await records.insertAutoCleanupRecord("p1", input, now - 2 * DAY);
    await records.insertAutoCleanupRecord("p1", input, now - 31 * DAY);
    await records.insertAutoCleanupRecord("p2", input, now - 40 * DAY);
    expect(await count()).toBe(3);

    await new CleanupService().runCleanup();

    expect(await count()).toBe(1);
  });
});
