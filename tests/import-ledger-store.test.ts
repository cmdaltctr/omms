import { afterEach, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { ImportLedger, importLedgerDbPath } from "../src/services/storage/import-ledger.js";
import { tryAcquireBackfillLock } from "../src/services/storage/backfill-locks.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the import ledger and backfill lock stores (storage port S6).
// (r) read through the public API, (w) write then read back with a raw client,
// (s) a memory space switch moves the ledger's default path.

const previousStorage = CONFIG.storagePath;
const directories: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omms-ledger-store-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  CONFIG.storagePath = previousStorage;
  for (const dir of directories.splice(0)) await cleanupTursoTestDirectory(dir);
});

/** Reads one table with its own client so the read does not go through the store under test. */
async function rawRows(folder: string, sql: string): Promise<Record<string, unknown>[]> {
  const client = createClient({ url: `file:${join(folder, "import-ledger.db")}` });
  try {
    const result = await client.execute(sql);
    return result.rows.map((row) => ({ ...row }));
  } finally {
    client.close();
  }
}

it("(r) reads ledger rows back through the public API", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  const ledger = new ImportLedger();
  await ledger.begin({ key: "k1", sessionId: "s1", sourceFile: "f", projectHash: "h" });
  await ledger.complete("k1", "mem-1");
  await ledger.begin({ key: "k2", sessionId: "s1", sourceFile: "f", projectHash: "h" });
  await ledger.skip("k2", "empty");
  await ledger.begin({ key: "k3", sessionId: "s2", sourceFile: "f", projectHash: "h" });
  await ledger.fail("k3", "boom");

  expect(await ledger.get("k1")).toMatchObject({ status: "imported", memoryId: "mem-1" });
  expect(await ledger.peek("k2")).toMatchObject({ status: "skipped", skipReason: "empty" });
  expect(await ledger.peek("missing")).toBeNull();
  expect(await ledger.countByStatus()).toEqual({ imported: 1, skipped: 1, failed: 1 });
  expect((await ledger.findHandledByPrefix("s1", "k"))?.status).toBe("imported");
  expect([
    ...(await ledger.handledSessionIds(["s1", "s2"], { memories: true, profile: false })),
  ]).toEqual(["s1"]);
});

it("(w) ledger writes land in import_ledger with the stored column names", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  const ledger = new ImportLedger();
  await ledger.begin({ key: "kw", sessionId: "sw", sourceFile: "src.db", projectHash: "ph" });
  await ledger.complete("kw", "mem-w");
  expect(importLedgerDbPath()).toBe(join(folder, "import-ledger.db"));
  const rows = await rawRows(
    folder,
    "SELECT key, session_id, source_file, project_hash, status, memory_id, skip_reason FROM import_ledger"
  );
  expect(rows).toEqual([
    {
      key: "kw",
      session_id: "sw",
      source_file: "src.db",
      project_hash: "ph",
      status: "imported",
      memory_id: "mem-w",
      skip_reason: null,
    },
  ]);
  const names = await rawRows(folder, "SELECT name FROM sqlite_master WHERE type = 'index'");
  expect(names.map((row) => row.name)).toEqual(
    expect.arrayContaining(["idx_import_ledger_session", "idx_import_ledger_status"])
  );
});

it("(w) the backfill lock is held in backfill_locks and removed on release", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  const release = await tryAcquireBackfillLock("pi", folder);
  expect(release).not.toBeNull();
  const held = await rawRows(folder, "SELECT host, pid FROM backfill_locks");
  expect(held).toEqual([{ host: "pi", pid: process.pid }]);
  expect(await tryAcquireBackfillLock("pi", folder)).toBeNull();
  await release!();
  expect(await rawRows(folder, "SELECT host FROM backfill_locks")).toEqual([]);
});

it("(r) the backfill lock defaults to the active storage path", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  const release = await tryAcquireBackfillLock("opencode");
  expect(release).not.toBeNull();
  expect((await rawRows(folder, "SELECT host FROM backfill_locks")).map((r) => r.host)).toEqual([
    "opencode",
  ]);
  await release!();
});

it("(s) the ledger default path follows a space switch and leaves the other space unchanged", async () => {
  const spaceA = tempDir();
  const spaceB = tempDir();
  CONFIG.storagePath = spaceA;
  await new ImportLedger().begin({ key: "ka", sessionId: "a", sourceFile: "f", projectHash: "h" });

  CONFIG.storagePath = spaceB;
  expect(importLedgerDbPath()).toBe(join(spaceB, "import-ledger.db"));
  const inB = new ImportLedger();
  expect(await inB.countByStatus()).toEqual({});
  await inB.begin({ key: "kb", sessionId: "b", sourceFile: "f", projectHash: "h" });
  // The same instance keeps following the live path after the switch.
  CONFIG.storagePath = spaceA;
  expect(await inB.get("kb")).toBeNull();
  expect(await inB.get("ka")).toMatchObject({ status: "in-progress" });

  expect((await rawRows(spaceA, "SELECT key FROM import_ledger")).map((r) => r.key)).toEqual([
    "ka",
  ]);
  expect((await rawRows(spaceB, "SELECT key FROM import_ledger")).map((r) => r.key)).toEqual([
    "kb",
  ]);
});

it("the old importer paths still re-export the stores", async () => {
  const oldLedger = await import("../src/importer/ledger.js");
  const oldLock = await import("../src/importer/backfill-lock.js");
  expect(oldLedger.ImportLedger).toBe(ImportLedger);
  expect(oldLedger.importLedgerDbPath).toBe(importLedgerDbPath);
  expect(oldLock.tryAcquireBackfillLock).toBe(tryAcquireBackfillLock);
});
