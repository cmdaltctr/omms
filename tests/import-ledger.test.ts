import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { ImportLedger, PiImportLedger } from "../src/importer/ledger.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

const storage = mkdtempSync(join(tmpdir(), "omms-import-ledger-"));
const previousStorage = CONFIG.storagePath;
afterEach(async () => {
  await tursoConnectionManager.closeConnection(join(storage, "import-ledger.db"));
  CONFIG.storagePath = previousStorage;
  rmSync(storage, { recursive: true, force: true });
});

it("round-trips an OpenCode key through the shared ledger", async () => {
  expect(PiImportLedger).toBe(ImportLedger);
  CONFIG.storagePath = storage;
  const ledger = new ImportLedger();
  const key = "opencode:session:user:assistant";
  await ledger.begin({ key, sessionId: "session", sourceFile: "opencode.db", projectHash: "hash" });
  await ledger.complete(key, "memory-1");
  expect(await new ImportLedger().get(key)).toMatchObject({
    key,
    sessionId: "session",
    status: "imported",
    memoryId: "memory-1",
  });
});
