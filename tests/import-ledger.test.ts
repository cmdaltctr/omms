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

it("peeks without creating the ledger schema", async () => {
  CONFIG.storagePath = storage;
  const path = join(storage, "import-ledger.db");
  const db = await tursoConnectionManager.getConnection(path);
  await db.run("CREATE TABLE unrelated (id INTEGER)");
  const tables = async () =>
    (await db.all("SELECT name FROM sqlite_master ORDER BY name")).map((row) => String(row.name));

  expect(await new ImportLedger().peek("opencode:s:u:a#profile")).toBeNull();
  expect(await tables()).toEqual(["unrelated"]);

  const { importProfileFromHistory } = await import("../src/importer/profile-import.js");
  const report = await importProfileFromHistory(
    [
      {
        sessionId: "s",
        directory: storage,
        sourceFile: "opencode.db",
        units: [
          {
            userEntryId: "u",
            userPrompt: "Fix the importer",
            textResponses: ["Done"],
            toolCalls: [],
            sourceEntryIds: ["a"],
          },
        ],
      },
    ],
    { host: "opencode", dryRun: true }
  );
  expect(report.promptsWouldRecord).toBe(1);
  expect(await tables()).toEqual(["unrelated"]);
});
