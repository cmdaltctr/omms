import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setupLedger() {
  const storage = mkdtempSync(join(tmpdir(), "pi-import-ledger-"));
  tempDirs.push(storage);
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = storage;
  CONFIG.embeddingDimensions = 4;
  const { PiImportLedger, importLedgerDbPath } = await import("../src/importer/ledger.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const ledger = new PiImportLedger();
  return { ledger, importLedgerDbPath, storage, tursoConnectionManager, CONFIG };
}

describe("Pi import ledger", () => {
  it("records the full state lifecycle for one key", async () => {
    const { ledger } = await setupLedger();
    const key = "pi:session-1:u1:a1";

    await ledger.begin({
      key,
      sessionId: "session-1",
      sourceFile: "/tmp/s1.jsonl",
      projectHash: "abcdef0123456789",
    });
    expect((await ledger.get(key))?.status).toBe("in-progress");

    await ledger.complete(key, "mem_1");
    const completed = await ledger.get(key);
    expect(completed?.status).toBe("imported");
    expect(completed?.memoryId).toBe("mem_1");
    expect(completed?.sessionId).toBe("session-1");

    await ledger.skip(key, "extractor-skip:skip");
    expect((await ledger.get(key))?.status).toBe("skipped");
    expect((await ledger.get(key))?.skipReason).toBe("extractor-skip:skip");

    await ledger.fail(key, "provider offline");
    expect((await ledger.get(key))?.status).toBe("failed");
    expect((await ledger.get(key))?.skipReason).toBe("provider offline");

    // begin over a failed row resets to in-progress
    await ledger.begin({
      key,
      sessionId: "session-1",
      sourceFile: "/tmp/s1.jsonl",
      projectHash: "abcdef0123456789",
    });
    expect((await ledger.get(key))?.status).toBe("in-progress");
  });

  it("keeps rows for separate keys isolated", async () => {
    const { ledger } = await setupLedger();
    await ledger.begin({ key: "k1", sessionId: "s1", sourceFile: "f1", projectHash: "h1" });
    await ledger.complete("k1", "mem_a");
    await ledger.begin({ key: "k2", sessionId: "s1", sourceFile: "f1", projectHash: "h1" });
    await ledger.skip("k2", "extractor-skip:skip");

    expect((await ledger.get("k1"))?.status).toBe("imported");
    expect((await ledger.get("k2"))?.status).toBe("skipped");
    expect(await ledger.get("missing")).toBeNull();
  });

  it("aggregates status counts", async () => {
    const { ledger } = await setupLedger();
    await ledger.begin({ key: "k1", sessionId: "s", sourceFile: "f", projectHash: "h" });
    await ledger.complete("k1", "m1");
    await ledger.skip("k2", "extractor-skip:skip");
    await ledger.skip("k3", "extractor-skip:skip");
    await ledger.fail("k4", "boom");

    const counts = await ledger.countByStatus();
    expect(counts).toEqual({ imported: 1, skipped: 2, failed: 1 });
  });
});
