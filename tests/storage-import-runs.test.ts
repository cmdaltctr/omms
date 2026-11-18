import { afterEach, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import {
  isBackfillPaused,
  readImportRun,
  setBackfillPaused,
  startImportRun,
} from "../src/importer/import-runs.js";
import {
  getBackfillCutoff,
  readBackfillStatus,
  readUnresolvedDirectories,
  recordUnresolvedDirectories,
  updateBackfillStatus,
} from "../src/services/backfill-state.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the import-runs and backfill-state stores (storage port S7).
// Both live in import-ledger.db. (r) read through the public API, (w) write then
// read back with a raw client, (s) a memory space switch moves both stores' path,
// (u) a file with the old schema gains the ALTERed columns and keeps its rows.

const previousStorage = CONFIG.storagePath;
const previousKey = CONFIG.memoryApiKey;
const directories: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omms-import-runs-store-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  CONFIG.storagePath = previousStorage;
  CONFIG.memoryApiKey = previousKey;
  for (const dir of directories.splice(0)) await cleanupTursoTestDirectory(dir);
});

const ledgerFile = (folder: string) => join(folder, "import-ledger.db");

/** Runs SQL with its own client so the check does not go through the store under test. */
async function raw(folder: string, sql: string, args: unknown[] = []) {
  const client = createClient({ url: `file:${ledgerFile(folder)}` });
  try {
    const result = await client.execute({ sql, args: args as never });
    return result.rows.map((row) => ({ ...row }));
  } finally {
    client.close();
  }
}

it("(r) import runs read back through the public API, with a redacted error", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  CONFIG.memoryApiKey = "sk-secret-key";
  expect(await readImportRun("pi")).toBeNull();
  expect(existsSync(ledgerFile(folder))).toBe(false);

  const recorder = await startImportRun("pi", "cli", { intervalMs: 0 });
  recorder.progress(2, 5);
  await recorder.finish(
    "failed",
    { total: 5, done: 3, imported: 2, skipped: 1, failed: 1 },
    "boom sk-secret-key"
  );
  expect(await readImportRun("pi")).toMatchObject({
    host: "pi",
    surface: "cli",
    state: "failed",
    total: 5,
    done: 3,
    imported: 2,
    skipped: 1,
    failed: 1,
    error: "boom [redacted]",
    paused: false,
    phase: "exchanges",
    percent: 60,
  });

  expect(await isBackfillPaused("opencode")).toBe(false);
  await setBackfillPaused("opencode", true);
  expect(await isBackfillPaused("opencode")).toBe(true);
});

it("(r) a running import run whose process is gone reads as stopped", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  await setBackfillPaused("pi", false);
  await raw(folder, "UPDATE import_runs SET state = 'running', pid = ? WHERE host = 'pi'", [
    2 ** 31 - 2,
  ]);
  expect((await readImportRun("pi"))?.state).toBe("stopped");
});

it("(w) import run writes land in import_runs with the stored column names", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  const recorder = await startImportRun("claude-code", "web", {
    intervalMs: 0,
    phase: "skill-turns",
    now: () => 1_000,
  });
  recorder.profileProgress(1, 4);
  await recorder.finish("done", { total: 9, done: 9, imported: 7, skipped: 2, failed: 0 });
  const rows = await raw(
    folder,
    `SELECT host, surface, state, pid, started_at, total, done, imported, skipped, failed, error,
       updated_at, paused, phase, profile_done, profile_total FROM import_runs ORDER BY host`
  );
  expect(rows.map((row) => row.host)).toEqual(["claude-code", "opencode", "pi"]);
  expect(rows[0]).toEqual({
    host: "claude-code",
    surface: "web",
    state: "done",
    pid: process.pid,
    started_at: 1_000,
    total: 9,
    done: 9,
    imported: 7,
    skipped: 2,
    failed: 0,
    error: null,
    updated_at: 1_000,
    paused: 0,
    phase: "profile",
    profile_done: 1,
    profile_total: 4,
  });
});

it("(s) import runs follow a space switch and leave the other space unchanged", async () => {
  const spaceA = tempDir();
  const spaceB = tempDir();
  CONFIG.storagePath = spaceA;
  await (await startImportRun("pi", "cli")).finish("done", { total: 1, done: 1, imported: 1 });

  CONFIG.storagePath = spaceB;
  expect(await readImportRun("pi")).toBeNull();
  expect(existsSync(ledgerFile(spaceB))).toBe(false);
  await (await startImportRun("pi", "web")).finish("stopped", { total: 4, done: 2 });
  await setBackfillPaused("pi", true);

  CONFIG.storagePath = spaceA;
  expect(await readImportRun("pi")).toMatchObject({ surface: "cli", state: "done", paused: false });
  CONFIG.storagePath = spaceB;
  expect(await readImportRun("pi")).toMatchObject({
    surface: "web",
    state: "stopped",
    paused: true,
  });
  expect(await raw(spaceA, "SELECT surface, paused FROM import_runs WHERE host = 'pi'")).toEqual([
    { surface: "cli", paused: 0 },
  ]);
});

it("(u) an import_runs table from before the phase columns upgrades with its rows kept", async () => {
  const folder = tempDir();
  // The schema before phase, profile_done and profile_total were added.
  await raw(
    folder,
    `CREATE TABLE import_runs (
      host TEXT PRIMARY KEY, surface TEXT, state TEXT, pid INTEGER, started_at INTEGER,
      total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at INTEGER,
      samples TEXT, paused INTEGER NOT NULL DEFAULT 0
    )`
  );
  await raw(
    folder,
    `INSERT INTO import_runs (host, surface, state, total, done, imported, updated_at)
     VALUES ('opencode', 'auto', 'done', 8, 8, 6, 42)`
  );
  CONFIG.storagePath = folder;
  // A read never alters the file.
  expect(await readImportRun("opencode")).toMatchObject({
    state: "done",
    phase: "exchanges",
    profileDone: 0,
  });
  await setBackfillPaused("pi", true);

  const columns = (await raw(folder, "PRAGMA table_info(import_runs)")).map((row) => row.name);
  expect(columns).toEqual(expect.arrayContaining(["phase", "profile_done", "profile_total"]));
  expect(await readImportRun("opencode")).toMatchObject({
    surface: "auto",
    state: "done",
    total: 8,
    imported: 6,
    phase: "exchanges",
    profileDone: 0,
    profileTotal: 0,
  });
  expect(
    (await raw(folder, "SELECT host FROM import_runs ORDER BY host")).map((r) => r.host)
  ).toEqual(["claude-code", "opencode", "pi"]);
});

it("(r) backfill state reads back through the public API, with a redacted error", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  expect(await readBackfillStatus("pi")).toBeNull();
  expect(await readUnresolvedDirectories("pi")).toEqual([]);
  expect(existsSync(ledgerFile(folder))).toBe(false);

  expect(await getBackfillCutoff("pi", 100)).toBe(100);
  expect(await getBackfillCutoff("pi", 200)).toBe(100);
  await updateBackfillStatus(
    "pi",
    {
      state: "failed",
      model: "m",
      counts: { imported: 1, skipped: 2, failed: 3, pending: 4, unresolved: -1 },
      error: new Error("bad key-xyz-123"),
    },
    { memoryApiKey: "key-xyz-123" }
  );
  expect(await readBackfillStatus("pi")).toMatchObject({
    cutoff: 100,
    state: "failed",
    model: "m",
    counts: { imported: 1, skipped: 2, failed: 3, pending: 4, unresolved: 0 },
    error: "bad [redacted]",
  });
  await recordUnresolvedDirectories("pi", [{ directory: "/a", sessions: 2 }], 5);
  expect(await readUnresolvedDirectories("pi")).toEqual([{ directory: "/a", sessions: 2 }]);
});

it("(w) backfill state writes land in backfill_state and unresolved_directories", async () => {
  const folder = tempDir();
  CONFIG.storagePath = folder;
  await getBackfillCutoff("opencode", 7);
  await recordUnresolvedDirectories("opencode", [{ directory: "/x", sessions: 1 }], 9, "partial");
  expect(
    await raw(
      folder,
      "SELECT host, cutoff, state, model, counts, error, updated_at FROM backfill_state"
    )
  ).toEqual([
    {
      host: "opencode",
      cutoff: 7,
      state: "not-started",
      model: null,
      counts: JSON.stringify({ imported: 0, skipped: 0, failed: 0, pending: 0, unresolved: 0 }),
      error: null,
      updated_at: 7,
    },
  ]);
  expect(
    await raw(folder, "SELECT host, directories, updated_at, coverage FROM unresolved_directories")
  ).toEqual([
    {
      host: "opencode",
      directories: JSON.stringify([{ directory: "/x", sessions: 1 }]),
      updated_at: 9,
      coverage: "partial",
    },
  ]);
});

it("(s) backfill state follows a space switch and leaves the other space unchanged", async () => {
  const spaceA = tempDir();
  const spaceB = tempDir();
  CONFIG.storagePath = spaceA;
  await getBackfillCutoff("pi", 10);
  await recordUnresolvedDirectories("pi", [{ directory: "/in-a", sessions: 1 }]);

  CONFIG.storagePath = spaceB;
  expect(await readBackfillStatus("pi")).toBeNull();
  expect(await readUnresolvedDirectories("pi")).toEqual([]);
  expect(existsSync(ledgerFile(spaceB))).toBe(false);
  expect(await getBackfillCutoff("pi", 20)).toBe(20);
  await recordUnresolvedDirectories("pi", [{ directory: "/in-b", sessions: 3 }]);

  CONFIG.storagePath = spaceA;
  expect((await readBackfillStatus("pi"))?.cutoff).toBe(10);
  expect(await readUnresolvedDirectories("pi")).toEqual([{ directory: "/in-a", sessions: 1 }]);
  expect(await raw(spaceA, "SELECT cutoff FROM backfill_state")).toEqual([{ cutoff: 10 }]);
});

it("(u) an unresolved_directories table from before the coverage column upgrades with its rows kept", async () => {
  const folder = tempDir();
  await raw(
    folder,
    `CREATE TABLE unresolved_directories (
      host TEXT PRIMARY KEY, directories TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`
  );
  await raw(
    folder,
    `INSERT INTO unresolved_directories (host, directories, updated_at) VALUES ('pi', ?, 1)`,
    [JSON.stringify([{ directory: "/old", sessions: 4 }])]
  );
  CONFIG.storagePath = folder;
  expect(await readUnresolvedDirectories("pi")).toEqual([{ directory: "/old", sessions: 4 }]);
  // The old row counts as a full list, so a partial list does not replace it.
  await recordUnresolvedDirectories("pi", [{ directory: "/new", sessions: 1 }], 2, "partial");
  expect(await readUnresolvedDirectories("pi")).toEqual([{ directory: "/old", sessions: 4 }]);
  expect(
    await raw(folder, "SELECT host, coverage, updated_at FROM unresolved_directories")
  ).toEqual([{ host: "pi", coverage: "full", updated_at: 1 }]);
});

it("the old paths still reach the moved stores", async () => {
  const oldState = await import("../src/services/backfill-state.js");
  const port = await import("../src/services/storage/backfill-state.js");
  expect(oldState.updateBackfillStatus).toBe(port.updateBackfillStatus);
  expect(oldState.readUnresolvedDirectories).toBe(port.readUnresolvedDirectories);
  const runs = await import("../src/services/storage/import-runs.js");
  expect(setBackfillPaused).toBe(runs.setBackfillPaused);
});
