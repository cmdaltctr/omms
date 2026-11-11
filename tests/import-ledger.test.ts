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

async function seed(
  ledger: ImportLedger,
  rows: Array<{
    key: string;
    session: string;
    hash: string;
    end: "imported" | "skipped" | "failed" | "open";
  }>
) {
  for (const row of rows) {
    await ledger.begin({
      key: row.key,
      sessionId: row.session,
      sourceFile: "f",
      projectHash: row.hash,
    });
    if (row.end === "imported") await ledger.complete(row.key, "m");
    if (row.end === "skipped") await ledger.skip(row.key, "empty");
    if (row.end === "failed") await ledger.fail(row.key, "boom");
  }
}

it("handledSessionIds judges memory rows and profile rows apart", async () => {
  CONFIG.storagePath = storage;
  const ledger = new ImportLedger();
  await seed(ledger, [
    { key: "a:1", session: "both", hash: "h", end: "imported" },
    { key: "a:2", session: "both", hash: "h", end: "skipped" },
    { key: "a:1#profile", session: "both", hash: "profile", end: "imported" },
    { key: "b:1", session: "memOnly", hash: "h", end: "imported" },
    { key: "c:1", session: "failedMem", hash: "h", end: "imported" },
    { key: "c:2", session: "failedMem", hash: "h", end: "failed" },
    { key: "d:1", session: "openMem", hash: "h", end: "open" },
    { key: "e:1#profile", session: "profOnly", hash: "profile", end: "imported" },
  ]);
  const ids = ["both", "memOnly", "failedMem", "openMem", "profOnly", "nothing"];
  const both = { memories: true, profile: true };
  const mem = { memories: true, profile: false };
  const prof = { memories: false, profile: true };
  const none = { memories: false, profile: false };

  expect([...(await ledger.handledSessionIds(ids, mem))].sort()).toEqual(["both", "memOnly"]);
  expect([...(await ledger.handledSessionIds(ids, prof))].sort()).toEqual(["both", "profOnly"]);
  expect([...(await ledger.handledSessionIds(ids, both))]).toEqual(["both"]);
  expect((await ledger.handledSessionIds(ids, none)).size).toBe(0);
});

it("handledSessionIds reads a missing file or table as empty and creates nothing", async () => {
  CONFIG.storagePath = storage;
  const path = join(storage, "import-ledger.db");
  const db = await tursoConnectionManager.getConnection(path);
  await db.run("CREATE TABLE unrelated (id INTEGER)");
  const handled = await new ImportLedger().handledSessionIds(["s"], {
    memories: true,
    profile: true,
  });
  expect(handled.size).toBe(0);
  const tables = (await db.all("SELECT name FROM sqlite_master ORDER BY name")).map((row) =>
    String(row.name)
  );
  expect(tables).toEqual(["unrelated"]);
});

it("the OpenCode handled lookup ignores profile rows of the same prompt", async () => {
  CONFIG.storagePath = storage;
  const { handledLookupFor } = await import("../src/importer/handled-lookup.js");
  const lookup = handledLookupFor("opencode");
  const ledger = new ImportLedger();
  const query = (userEntryId: string, answer: string) => ({
    key: `opencode:ses:${userEntryId}:${answer}`,
    sessionId: "ses",
    window: { userEntryId } as never,
    readOnly: false,
  });

  // A failed memory unit whose profile step still recorded the prompt stays retryable.
  await seed(ledger, [
    { key: "opencode:ses:u1:a1", session: "ses", hash: "h", end: "failed" },
    { key: "opencode:ses:u1:a1#profile", session: "ses", hash: "profile", end: "imported" },
    { key: "opencode:ses:u2:a2#profile", session: "ses", hash: "profile", end: "imported" },
    { key: "opencode:ses:u3:old", session: "ses", hash: "h", end: "imported" },
  ]);
  expect((await lookup(ledger, query("u1", "a1")))?.status).toBe("failed");
  // A profile-only earlier run does not count as an imported memory.
  expect(await lookup(ledger, query("u2", "a2"))).toBeNull();
  // A memory imported under another last answer id still counts.
  expect((await lookup(ledger, query("u3", "new")))?.key).toBe("opencode:ses:u3:old");
});
