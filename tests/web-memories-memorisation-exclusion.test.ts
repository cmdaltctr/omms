import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string | undefined;

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
  baseDir = undefined;
});

/** One project shard holding a normal memory and a memorisation, both in the same project. */
async function setup() {
  baseDir = mkdtempSync(join(tmpdir(), "omms-web-memorisation-exclusion-"));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  CONFIG.embeddingDimensions = 8;
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const scopeHash = "a1b2c3d4e5f60718";
  const shard = await tursoShardManager.createShard("project", scopeHash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  const containerTag = `omms_project_${scopeHash}`;
  const vector = new Float32Array(8);
  vector[0] = 1;
  for (const [id, type, tags] of [
    ["mem_normal01", "discussion", "alpha"],
    ["ms-snap01", "memorisation", "memorisation"],
  ] as const) {
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `content of ${id}`,
      vector,
      containerTag,
      type,
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return { db, containerTag };
}

const ids = (rows: Array<{ id?: unknown }>) => rows.map((row) => String(row.id)).sort();

describe("web Memories page excludes memorisations", () => {
  it("lists only normal memories when no project tag is chosen", async () => {
    await setup();
    const { handleListMemories } = await import("../src/services/api-handlers.js");
    const result = await handleListMemories(undefined, 1, 20, false);
    const items = (result.data as { items: Array<{ id: string }> }).items;
    expect(ids(items)).toEqual(["mem_normal01"]);
  });

  it("lists only normal memories when a project tag is chosen", async () => {
    const { containerTag } = await setup();
    const { handleListMemories } = await import("../src/services/api-handlers.js");
    const result = await handleListMemories(containerTag, 1, 20, false);
    const items = (result.data as { items: Array<{ id: string }> }).items;
    expect(ids(items)).toEqual(["mem_normal01"]);
  });

  it("does not count the memorisation tag as a keyword", async () => {
    await setup();
    const { handleListKeywords } = await import("../src/services/api-handlers.js");
    const result = await handleListKeywords();
    const keywords = (result.data as { keywords: Array<{ keyword?: string; tag?: string }> })
      .keywords;
    const names = keywords.map((entry) => entry.keyword ?? entry.tag);
    expect(names).toEqual(["alpha"]);
  });

  it("counts only normal memories in stats total and byType", async () => {
    await setup();
    const { handleStats } = await import("../src/services/api-handlers.js");
    const result = await handleStats();
    const data = result.data as { total: number; byType: Record<string, number> };
    expect(data.total).toBe(1);
    expect(data.byType).toEqual({ discussion: 1 });
  });
});

describe("web Memories page refuses to change memorisations", () => {
  it("refuses to update a memorisation row and leaves it unchanged", async () => {
    const { db } = await setup();
    const { handleUpdateMemory } = await import("../src/services/api-handlers.js");
    const result = await handleUpdateMemory("ms-snap01", { content: "rewritten" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Memorisation page");
    const row = await db.get("SELECT content FROM memories WHERE id = 'ms-snap01'");
    expect(row?.content).toBe("content of ms-snap01");
  });

  it("refuses to turn a normal memory into a memorisation", async () => {
    const { db } = await setup();
    const { handleUpdateMemory } = await import("../src/services/api-handlers.js");
    const result = await handleUpdateMemory("mem_normal01", { type: "memorisation" as never });
    expect(result.success).toBe(false);
    expect(result.error).toContain("memorisation");
    const row = await db.get("SELECT type FROM memories WHERE id = 'mem_normal01'");
    expect(row?.type).toBe("discussion");
  });

  it("refuses to add a memory with type memorisation", async () => {
    const { db, containerTag } = await setup();
    const { handleAddMemory } = await import("../src/services/api-handlers.js");
    const result = await handleAddMemory({
      content: "sneaky",
      containerTag,
      type: "memorisation" as never,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("memorisation");
    const rows = await db.all("SELECT id FROM memories WHERE content = 'sneaky'");
    expect(rows).toHaveLength(0);
  });

  it("refuses a bulk delete that includes a memorisation and deletes nothing", async () => {
    const { db } = await setup();
    const { handleBulkDelete } = await import("../src/services/api-handlers.js");
    const result = await handleBulkDelete(["mem_normal01", "ms-snap01"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Memorisation page");
    const rows = await db.all("SELECT id FROM memories");
    expect(ids(rows)).toEqual(["mem_normal01", "ms-snap01"]);
  });

  it("still deletes a memorisation through the single delete the Memorisation page uses", async () => {
    const { db } = await setup();
    const { handleDeleteMemory } = await import("../src/services/api-handlers.js");
    const result = await handleDeleteMemory("ms-snap01");
    expect(result.success).toBe(true);
    const rows = await db.all("SELECT id FROM memories");
    expect(ids(rows)).toEqual(["mem_normal01"]);
  });
});
