import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

let directory: string;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-cleanup-store-"));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
});

afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
});

const entries = [
  {
    kind: "merge",
    section: "preferences",
    originals: [
      { category: "c", description: "one", centroid: [0.1, 0.2, 0.3] },
      { category: "c", description: "two" },
    ],
    merged: { category: "c", description: "one and two" },
  },
  { kind: "remove", section: "patterns", original: { category: "c", description: "gone" } },
] as const;

async function store() {
  return import("../src/services/user-profile/auto-cleanup-store.js");
}

describe("auto cleanup restore records", () => {
  it("stores a record and reads it back with its items intact", async () => {
    const s = await store();
    const id = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 300, merged: 1, removed: 1, entries: [...entries] },
      1_000
    );
    const record = await s.latestOpenAutoCleanup("p1", 2_000);
    expect(record).toEqual({
      id,
      createdAt: 1_000,
      promptsAnalyzed: 300,
      merged: 1,
      removed: 1,
      entries,
    });
  });

  it("summarises the newest open record without its items", async () => {
    const s = await store();
    await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 100, merged: 4, removed: 3, entries: [...entries] },
      5_000
    );
    expect(await s.latestOpenAutoCleanupSummary("p1", 6_000)).toEqual({
      id: expect.any(Number),
      createdAt: 5_000,
      merged: 4,
      removed: 3,
    });
  });

  it("returns null when the profile has no record", async () => {
    const s = await store();
    expect(await s.latestOpenAutoCleanup("p1")).toBeNull();
    expect(await s.latestOpenAutoCleanupSummary("p1")).toBeNull();
  });

  it("returns the newest record first, then the next older after an undo", async () => {
    const s = await store();
    const older = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 100, merged: 1, removed: 0, entries: [] },
      1_000
    );
    const newer = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 200, merged: 2, removed: 0, entries: [] },
      2_000
    );
    expect((await s.latestOpenAutoCleanup("p1", 3_000))?.id).toBe(newer);
    await s.markAutoCleanupUndone(newer, 3_000);
    expect((await s.latestOpenAutoCleanup("p1", 3_000))?.id).toBe(older);
    await s.markAutoCleanupUndone(older, 3_000);
    expect(await s.latestOpenAutoCleanup("p1", 3_000)).toBeNull();
  });

  it("returns the id of the row it inserted when two writers insert for one profile at once", async () => {
    const s = await store();
    const input = (n: number) => ({
      promptsAnalyzed: n,
      merged: n,
      removed: 0,
      entries: [],
    });
    const ids = await Promise.all(
      Array.from({ length: 8 }, (_, i) => s.insertAutoCleanupRecord("p1", input(i + 1), 1_000 + i))
    );
    expect(new Set(ids).size).toBe(8);
    // Each id belongs to its own row: deleting one leaves the other seven.
    for (const [i, id] of ids.entries()) {
      const record = await s.latestOpenAutoCleanup("p1", 2_000);
      expect(record).not.toBeNull();
      await s.deleteAutoCleanup(id);
      const left = await s.latestOpenAutoCleanup("p1", 2_000);
      expect(left === null || left.id !== id).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
    }
    expect(await s.latestOpenAutoCleanup("p1", 2_000)).toBeNull();
  });

  it("maps each returned id to the row with the same figures", async () => {
    const s = await store();
    const [a, b] = await Promise.all([
      s.insertAutoCleanupRecord(
        "p1",
        { promptsAnalyzed: 111, merged: 1, removed: 0, entries: [] },
        1_000
      ),
      s.insertAutoCleanupRecord(
        "p1",
        { promptsAnalyzed: 222, merged: 2, removed: 0, entries: [] },
        1_001
      ),
    ]);
    await s.deleteAutoCleanup(a);
    const left = await s.latestOpenAutoCleanup("p1", 2_000);
    expect(left).toMatchObject({ id: b, promptsAnalyzed: 222 });
  });

  it("prunes expired records with no other table access, for every profile", async () => {
    const s = await store();
    await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 1, merged: 1, removed: 0, entries: [] },
      0
    );
    await s.insertAutoCleanupRecord(
      "p2",
      { promptsAnalyzed: 1, merged: 1, removed: 0, entries: [] },
      5 * DAY
    );
    expect(await s.pruneAutoCleanupRecords(29 * DAY)).toBe(0);
    expect(await s.pruneAutoCleanupRecords(31 * DAY)).toBe(1);
    expect(await s.latestOpenAutoCleanup("p2", 31 * DAY)).not.toBeNull();
    expect(await s.pruneAutoCleanupRecords(36 * DAY)).toBe(1);
  });

  it("deletes a record", async () => {
    const s = await store();
    const id = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 100, merged: 1, removed: 0, entries: [] },
      1_000
    );
    await s.deleteAutoCleanup(id);
    expect(await s.latestOpenAutoCleanup("p1", 2_000)).toBeNull();
  });

  it("deletes a record older than 30 days when it is read, and keeps a younger one", async () => {
    const s = await store();
    const old = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 100, merged: 1, removed: 0, entries: [] },
      0
    );
    const young = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 200, merged: 1, removed: 0, entries: [] },
      2 * DAY
    );
    const now = 31 * DAY;
    expect((await s.latestOpenAutoCleanup("p1", now))?.id).toBe(young);
    await s.markAutoCleanupUndone(young, now);
    // The old record is 31 days old, so it is gone and cannot be undone.
    expect(await s.latestOpenAutoCleanup("p1", now)).toBeNull();
    expect(old).not.toBe(young);
  });

  it("keeps a record that is 29 days old", async () => {
    const s = await store();
    const id = await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 100, merged: 1, removed: 0, entries: [] },
      0
    );
    expect((await s.latestOpenAutoCleanup("p1", 29 * DAY))?.id).toBe(id);
  });

  it("does not mix the records of two profiles", async () => {
    const s = await store();
    await s.insertAutoCleanupRecord(
      "p1",
      { promptsAnalyzed: 100, merged: 1, removed: 0, entries: [] },
      1_000
    );
    expect(await s.latestOpenAutoCleanup("p2", 2_000)).toBeNull();
    expect(await s.latestOpenAutoCleanupSummary("p2", 2_000)).toBeNull();
  });
});
