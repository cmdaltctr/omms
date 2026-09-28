import { afterEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;
afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

it("tags only untagged memories, keeps tagged vectors, and moves past a failure", async () => {
  baseDir = mkdtempSync(join(tmpdir(), "omms-tag-migration-"));
  const { CONFIG } = await import("../src/config.js");
  Object.assign(CONFIG, {
    storagePath: baseDir,
    embeddingDimensions: 768,
    memoryProvider: "openai-chat",
    memoryModel: "m",
    memoryApiUrl: "https://x.invalid/v1",
    memoryApiKey: "k",
  });
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { embeddingService } = await import("../src/services/embedding.js");
  const { AIProviderFactory } = await import("../src/services/ai/ai-provider-factory.js");
  const { handleDetectTagMigration, handleRunTagMigrationBatch } =
    await import("../src/services/api-handlers.js");

  const vector = new Float32Array(768);
  vector[0] = 1;
  const shard = await tursoShardManager.createShard("project", "a1b2c3d4e5f60718", 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  for (const [id, tags] of [
    ["tagged", ["kept"]],
    ["untagged-ok", undefined],
    ["untagged-fails", undefined],
    ["untagged-embed-fails", undefined],
  ] as const) {
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `content of ${id}`,
      vector,
      containerTag: "omms_project_a1b2c3d4e5f60718",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(tags ? { tags: tags.join(",") } : {}),
    });
  }

  const embedded: string[] = [];
  const originalEmbed = embeddingService.embedWithTimeout;
  const originalCreate = AIProviderFactory.createProvider;
  embeddingService.embedWithTimeout = (async (text: string) => {
    if (text.includes("untagged-embed-fails")) throw new Error("embedding timed out");
    embedded.push(text);
    return vector;
  }) as typeof originalEmbed;
  AIProviderFactory.createProvider = (() => ({
    executeToolCall: async (_s: string, prompt: string) =>
      prompt.includes("untagged-fails")
        ? { success: false, error: "model refused" }
        : { success: true, data: { tags: ["Bun", "sqlite"] } },
  })) as unknown as typeof originalCreate;
  try {
    expect((await handleDetectTagMigration()).data).toEqual({ needsMigration: true, count: 3 });
    const first = await handleRunTagMigrationBatch(1);
    const second = await handleRunTagMigrationBatch(2);
    expect(first.data).toEqual({ processed: 1, total: 3, hasMore: true });
    expect(second.data).toEqual({ processed: 3, total: 3, hasMore: false });

    const rows = await db.all("SELECT id, tags FROM memories ORDER BY id");
    expect(rows.map((row) => [row.id, row.tags])).toEqual([
      ["tagged", "kept"],
      // Tags are saved only together with fresh vectors, so a failed embedding stays untagged.
      ["untagged-embed-fails", null],
      ["untagged-fails", null],
      ["untagged-ok", "bun,sqlite"],
    ]);
    // Only the memory that gained tags was re-embedded.
    expect(embedded.some((text) => text.includes("content of tagged"))).toBe(false);
    expect(embedded.some((text) => text.includes("untagged-ok"))).toBe(true);

    // A later run starts over with only what is still untagged.
    const retry = await handleRunTagMigrationBatch(5);
    expect(retry.data).toEqual({ processed: 2, total: 2, hasMore: false });
  } finally {
    embeddingService.embedWithTimeout = originalEmbed;
    AIProviderFactory.createProvider = originalCreate;
  }
});
