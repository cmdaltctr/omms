import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Regression test for TDR 081: the web memory edit must take the scope write lock
// that every other memory write takes, and must not write while another writer holds it.

let baseDir: string | undefined;
let restoreEmbedding: (() => void) | undefined;

afterEach(async () => {
  restoreEmbedding?.();
  restoreEmbedding = undefined;
  await cleanupTursoTestDirectory(baseDir);
  baseDir = undefined;
});

const scopeHash = "b1c2d3e4f5a60718";
const containerTag = `omms_project_${scopeHash}`;

/** One project shard with one memory, and an embedding stub that reports when it runs. */
async function setup() {
  baseDir = mkdtempSync(join(tmpdir(), "omms-web-update-lock-"));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  CONFIG.embeddingDimensions = 8;
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { embeddingService } = await import("../src/services/embedding.js");

  const vector = new Float32Array(8);
  vector[0] = 1;
  let embedded!: () => void;
  const embedStarted = new Promise<void>((resolve) => {
    embedded = resolve;
  });
  const originalWarmup = embeddingService.warmup;
  const originalEmbed = embeddingService.embedWithTimeout;
  embeddingService.warmup = (async () => undefined) as typeof originalWarmup;
  // The edit embeds after it reads the row, so this call marks the end of the read.
  embeddingService.embedWithTimeout = (async () => {
    embedded();
    return vector;
  }) as typeof originalEmbed;
  restoreEmbedding = () => {
    embeddingService.warmup = originalWarmup;
    embeddingService.embedWithTimeout = originalEmbed;
  };

  const shard = await tursoShardManager.createShard("project", scopeHash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  await tursoVectorSearch.insertVector(db, {
    id: "mem_lock01",
    content: "original content",
    vector,
    containerTag,
    type: "discussion",
    tags: "alpha",
    createdAt: 1000,
    updatedAt: 1000,
  });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Another writer holds the scope lock until the test releases it.
  const holder = tursoShardManager.withScopeWriteLock("project", scopeHash, () => gate);
  return { db, embedStarted, release, holder };
}

const storedContent = async (db: { get: (sql: string) => Promise<{ content?: unknown } | null> }) =>
  (await db.get("SELECT content FROM memories WHERE id = 'mem_lock01'"))?.content;

describe("web memory edit and the scope write lock", () => {
  it("waits for the scope write lock before it replaces the row", async () => {
    const { db, embedStarted, release, holder } = await setup();
    const { handleUpdateMemory } = await import("../src/services/api-handlers.js");

    const edit = handleUpdateMemory("mem_lock01", { content: "edited content" });
    await embedStarted;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await storedContent(db)).toBe("original content");

    release();
    await holder;
    expect(await edit).toEqual({ success: true });
    expect(await storedContent(db)).toBe("edited content");
    const row = await db.get("SELECT type, tags, created_at FROM memories WHERE id = 'mem_lock01'");
    expect([row?.type, row?.tags, Number(row?.created_at)]).toEqual(["discussion", "alpha", 1000]);
  });

  it("returns Memory not found when the row goes away before the lock", async () => {
    const { db, embedStarted, release, holder } = await setup();
    const { handleUpdateMemory } = await import("../src/services/api-handlers.js");

    const edit = handleUpdateMemory("mem_lock01", { content: "edited content" });
    await embedStarted;
    await db.run("DELETE FROM memories WHERE id = ?", ["mem_lock01"]);

    release();
    await holder;
    expect(await edit).toEqual({ success: false, error: "Memory not found" });
    const rows = await db.all("SELECT id FROM memories");
    expect(rows).toHaveLength(0);
  });
});
