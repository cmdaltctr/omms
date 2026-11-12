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
    // Each batch reports how many memories gained tags and how many failed, with the first error.
    expect(first.data).toEqual({
      processed: 1,
      total: 3,
      hasMore: true,
      tagged: 0,
      failed: 1,
      errorKind: "other",
      error: "embedding timed out",
    });
    expect(second.data).toEqual({
      processed: 3,
      total: 3,
      hasMore: false,
      tagged: 1,
      failed: 2,
      errorKind: "other",
      error: "embedding timed out",
    });

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
    expect(retry.data).toMatchObject({ processed: 2, total: 2, hasMore: false, failed: 2 });
  } finally {
    embeddingService.embedWithTimeout = originalEmbed;
    AIProviderFactory.createProvider = originalCreate;
  }
});

it("stops at the first no-credit error, says why, and starts over on the next run", async () => {
  baseDir = mkdtempSync(join(tmpdir(), "omms-tag-migration-"));
  const { CONFIG } = await import("../src/config.js");
  Object.assign(CONFIG, {
    storagePath: baseDir,
    embeddingDimensions: 768,
    memoryProvider: "openai-chat",
    memoryModel: "m",
    memoryApiUrl: "https://x.invalid/v1",
    memoryApiKey: "sk-secret-key-123",
  });
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { AIProviderFactory } = await import("../src/services/ai/ai-provider-factory.js");
  const { handleRunTagMigrationBatch } = await import("../src/services/api-handlers.js");

  const vector = new Float32Array(768);
  vector[0] = 1;
  const shard = await tursoShardManager.createShard("project", "a1b2c3d4e5f60718", 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  for (const id of ["one", "two", "three"]) {
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `content of ${id}`,
      vector,
      containerTag: "omms_project_a1b2c3d4e5f60718",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  let calls = 0;
  const originalCreate = AIProviderFactory.createProvider;
  AIProviderFactory.createProvider = (() => ({
    executeToolCall: async () => {
      calls++;
      // The real reply from a provider whose account is empty, with the key echoed back.
      return {
        success: false,
        error:
          'API error: 402 - {"error":{"message":"Insufficient Balance for sk-secret-key-123","type":"insufficient_balance_error"}}',
      };
    },
  })) as unknown as typeof originalCreate;
  try {
    const run = await handleRunTagMigrationBatch(5);
    // One call is enough: every other memory would fail the same way.
    expect(calls).toBe(1);
    expect(run.data).toMatchObject({
      processed: 1,
      total: 3,
      hasMore: false,
      tagged: 0,
      failed: 1,
      errorKind: "no_credit",
    });
    expect(run.data?.error).toContain("Insufficient Balance");
    expect(run.data?.error).not.toContain("sk-secret-key-123");

    // The next run (after a top-up) covers all three memories again.
    const again = await handleRunTagMigrationBatch(5);
    expect(again.data).toMatchObject({ total: 3, errorKind: "no_credit" });
  } finally {
    AIProviderFactory.createProvider = originalCreate;
  }
});
