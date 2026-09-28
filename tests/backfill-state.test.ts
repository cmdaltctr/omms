import { afterEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { importLedgerDbPath } from "../src/importer/ledger.js";
import {
  getBackfillCutoff,
  readBackfillStatus,
  readUnresolvedDirectories,
  recordUnresolvedDirectories,
  summarizeUnresolvedDirectories,
  updateBackfillStatus,
} from "../src/services/backfill-state.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const previousStorage = CONFIG.storagePath;
let directory: string;
afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

it("stores each host's cutoff once and persists only bounded status metadata", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-backfill-state-"));
  CONFIG.storagePath = directory;
  expect(await readBackfillStatus("pi")).toBeNull();
  expect(await getBackfillCutoff("pi", 100)).toBe(100);
  expect(await getBackfillCutoff("pi", 200)).toBe(100);
  expect(await getBackfillCutoff("opencode", 300)).toBe(300);
  await updateBackfillStatus("pi", {
    state: "failed",
    model: "zai/glm-5-turbo",
    counts: { imported: 2, skipped: 1, failed: 1, pending: 3, unresolved: 4 },
    error: new Error("api_key=secret-token"),
  });
  const status = await readBackfillStatus("pi");
  expect(status).toMatchObject({
    host: "pi",
    cutoff: 100,
    state: "failed",
    model: "zai/glm-5-turbo",
  });
  expect(status?.counts).toEqual({ imported: 2, skipped: 1, failed: 1, pending: 3, unresolved: 4 });
  const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
  const row = await db.get<{ counts: string; error: string }>(
    "SELECT counts, error FROM backfill_state WHERE host = 'pi'"
  );
  expect(row?.counts).not.toContain("prompt");
  expect(row?.error).not.toContain("secret-token");
});

it("stores unresolved directories with session counts, capped at 200, paths only", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-backfill-state-"));
  CONFIG.storagePath = directory;
  const sessions = [
    { directory: "/gone/a" },
    { directory: "/gone/a" },
    { directory: null },
    { directory: "/gone/b", sessions: 3 },
    ...Array.from({ length: 250 }, (_, i) => ({ directory: `/tmp/t${i}` })),
  ];
  const summary = summarizeUnresolvedDirectories(sessions);
  expect(summary).toHaveLength(200);
  expect(summary.slice(0, 2)).toEqual([
    { directory: "/gone/b", sessions: 3 },
    { directory: "/gone/a", sessions: 2 },
  ]);
  expect(await readUnresolvedDirectories("pi")).toEqual([]);
  await recordUnresolvedDirectories("pi", summary, 100);
  expect(await readUnresolvedDirectories("pi")).toEqual(summary);
  // Recording a listing must not start a backfill or fix its cutoff.
  expect(await readBackfillStatus("pi")).toBeNull();
  const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
  const row = await db.get<{ directories: string }>(
    "SELECT directories FROM unresolved_directories WHERE host = 'pi'"
  );
  expect(Object.keys(JSON.parse(row!.directories)[0]).sort()).toEqual(["directory", "sessions"]);
});
