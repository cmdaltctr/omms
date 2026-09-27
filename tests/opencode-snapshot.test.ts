import { afterEach, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));
const {
  OpencodeSnapshotRegistry,
  SNAPSHOT_PREFIX,
  checkSnapshotSpace,
  createOpencodeSnapshot,
  sweepOrphanSnapshots,
} = await import("../src/importer/opencode-snapshot.js");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "omms-snapshot-test-"));
  dirs.push(root);
  const folder = join(root, "tmp");
  mkdirSync(folder);
  const db = join(root, "opencode.db");
  writeFileSync(db, Buffer.alloc(2 * 1024 * 1024, 1));
  writeFileSync(`${db}-wal`, Buffer.alloc(64 * 1024, 2));
  return { root, folder, db };
}

const snapshots = (folder: string) =>
  readdirSync(folder).filter((name) => name.startsWith(SNAPSHOT_PREFIX));

it("fails before copying when temporary space is short, with both sizes", () => {
  const { db, folder } = workspace();
  expect(() => checkSnapshotSpace(db, folder, 1024)).toThrow(/needs 259 MB, 1 MB free/);
  expect(snapshots(folder)).toEqual([]);
});

it("copies the database and WAL without blocking the event loop", async () => {
  const { db, folder } = workspace();
  writeFileSync(db, Buffer.alloc(32 * 1024 * 1024, 1));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  // The streamed path is the slow one, used across devices; force it here.
  const copy = await createOpencodeSnapshot(db, { folder, clone: false });
  clearInterval(timer);
  expect(ticks).toBeGreaterThan(0);
  expect(existsSync(copy.path)).toBe(true);
  expect(existsSync(`${copy.path}-wal`)).toBe(true);
  expect(existsSync(join(copy.dir, "owner.json"))).toBe(true);
  expect(snapshots(folder)).toHaveLength(1);
});

it("leaves no folder behind when the copy is cancelled", async () => {
  const { db, folder } = workspace();
  const controller = new AbortController();
  controller.abort();
  await expect(createOpencodeSnapshot(db, { folder, signal: controller.signal })).rejects.toThrow();
  expect(snapshots(folder)).toEqual([]);
});

it("sweeps folders whose owner process is gone and keeps live ones", async () => {
  const { folder } = workspace();
  const dead = join(folder, `${SNAPSHOT_PREFIX}dead`);
  const live = join(folder, `${SNAPSHOT_PREFIX}live`);
  const creating = join(folder, `${SNAPSHOT_PREFIX}creating`);
  for (const dir of [dead, live, creating]) mkdirSync(dir);
  writeFileSync(join(dead, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
  writeFileSync(join(live, "owner.json"), JSON.stringify({ pid: process.pid }));
  expect(await sweepOrphanSnapshots(folder)).toBe(1);
  expect(snapshots(folder).sort()).toEqual(
    [`${SNAPSHOT_PREFIX}creating`, `${SNAPSHOT_PREFIX}live`].sort()
  );
});

it("shares one copy across listing, preview, and import, and expires it", async () => {
  const { db, folder } = workspace();
  let created = 0;
  const registry = new OpencodeSnapshotRegistry(20, (path, options) => {
    created++;
    return createOpencodeSnapshot(path, { ...options, folder });
  });
  const listing = await registry.acquire("k", db, "fresh");
  await listing.release();
  const preview = await registry.acquire("k", db, "reuse");
  const job = await registry.acquire("k", db, "reuse");
  expect(preview.path).toBe(listing.path);
  expect(job.path).toBe(listing.path);
  expect(created).toBe(1);

  // A refresh makes a new copy; the job keeps reading the old one until it finishes.
  const refreshed = await registry.acquire("k", db, "fresh");
  expect(refreshed.path).not.toBe(job.path);
  expect(snapshots(folder)).toHaveLength(2);
  await preview.release();
  await job.release();
  expect(snapshots(folder)).toHaveLength(1);

  await refreshed.release();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(snapshots(folder)).toEqual([]);
  await expect(registry.acquire("k", db, "reuse")).rejects.toMatchObject({ code: "expired" });
  await registry.closeAll();
});

it("drops the shared copy after an import, but not while a job still reads it", async () => {
  const { db, folder } = workspace();
  const registry = new OpencodeSnapshotRegistry(60_000, (path, options) =>
    createOpencodeSnapshot(path, { ...options, folder })
  );
  const listing = await registry.acquire("k", db, "fresh");
  await listing.release();
  const job = await registry.acquire("k", db, "reuse");
  registry.discard("k");
  expect(snapshots(folder)).toHaveLength(1);
  await job.release();
  expect(snapshots(folder)).toEqual([]);
  await expect(registry.acquire("k", db, "reuse")).rejects.toMatchObject({ code: "expired" });
});
