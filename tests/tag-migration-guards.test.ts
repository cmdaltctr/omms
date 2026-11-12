import { afterEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;
afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

type ToolCall = (system: string, prompt: string) => Promise<unknown>;

/** A fresh store with untagged memories, a stub model and a stub embedder. */
async function setUp(ids: string[], apiKey: string, call: ToolCall, embedFails = "") {
  baseDir = mkdtempSync(join(tmpdir(), "omms-tag-migration-guards-"));
  const { CONFIG } = await import("../src/config.js");
  Object.assign(CONFIG, {
    storagePath: baseDir,
    embeddingDimensions: 768,
    memoryProvider: "openai-chat",
    memoryModel: "m",
    memoryApiUrl: "https://x.invalid/v1",
    memoryApiKey: apiKey,
  });
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { embeddingService } = await import("../src/services/embedding.js");
  const { AIProviderFactory } = await import("../src/services/ai/ai-provider-factory.js");
  const vector = new Float32Array(768);
  vector[0] = 1;
  const shard = await tursoShardManager.createShard("project", "a1b2c3d4e5f60718", 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  for (const id of ids) {
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `content of ${id}`,
      vector,
      containerTag: "omms_project_a1b2c3d4e5f60718",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  const originalEmbed = embeddingService.embedWithTimeout;
  const originalCreate = AIProviderFactory.createProvider;
  embeddingService.embedWithTimeout = (async (text: string) => {
    if (embedFails && text.includes(embedFails)) throw new Error("embedding timed out");
    return vector;
  }) as typeof originalEmbed;
  AIProviderFactory.createProvider = (() => ({
    executeToolCall: call,
  })) as unknown as typeof originalCreate;
  return {
    db,
    restore() {
      embeddingService.embedWithTimeout = originalEmbed;
      AIProviderFactory.createProvider = originalCreate;
    },
  };
}

const tagged = async () => ({ success: true, data: { tags: ["bun"] } });

it("tags every memory when batch requests overlap", async () => {
  const { db, restore } = await setUp(["a", "b", "c", "d"], "sk-long-enough-key", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return tagged();
  });
  try {
    const { handleRunTagMigrationBatch } = await import("../src/services/api-handlers.js");
    await handleRunTagMigrationBatch(1);
    // Two callers (two open tabs) ask for the next batch at the same time.
    await Promise.all([handleRunTagMigrationBatch(1), handleRunTagMigrationBatch(1)]);
    const last = await handleRunTagMigrationBatch(1);
    expect(last.data).toMatchObject({ processed: 4, total: 4, hasMore: false, tagged: 4 });
    const rows = await db.all("SELECT id FROM memories WHERE tags IS NULL OR tags = ''");
    expect(rows).toEqual([]);
  } finally {
    restore();
  }
});

it("reports the no-credit error that stopped the run, after an earlier failure", async () => {
  const { restore } = await setUp(
    ["a-embed", "b", "c"],
    "sk-long-enough-key",
    async (_s, prompt) =>
      prompt.includes("content of b")
        ? { success: false, error: "API error: 402 - Insufficient Balance" }
        : tagged(),
    "a-embed"
  );
  try {
    const { handleRunTagMigrationBatch } = await import("../src/services/api-handlers.js");
    const run = await handleRunTagMigrationBatch(5);
    expect(run.data).toMatchObject({
      processed: 2,
      hasMore: false,
      failed: 2,
      errorKind: "no_credit",
    });
    expect(run.data?.error).toContain("Insufficient Balance");
  } finally {
    restore();
  }
});

it("never returns a short API key in the error", async () => {
  const { restore } = await setUp(["a"], "k3y", async () => ({
    success: false,
    error: "API error: 401 - invalid key k3y",
  }));
  try {
    const { handleRunTagMigrationBatch } = await import("../src/services/api-handlers.js");
    const run = await handleRunTagMigrationBatch(5);
    expect(run.data?.errorKind).toBe("auth");
    expect(run.data?.error).not.toContain("k3y");
  } finally {
    restore();
  }
});

it("forgets a half-done run when the memory space changes", async () => {
  const { restore } = await setUp(["a", "b", "c"], "sk-long-enough-key", tagged);
  try {
    const { handleRunTagMigrationBatch, handleGetTagMigrationProgress } =
      await import("../src/services/api-handlers.js");
    expect((await handleRunTagMigrationBatch(1)).data).toMatchObject({ processed: 1, total: 3 });
    const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
    await resetStoreHandles();
    expect((await handleGetTagMigrationProgress()).data).toMatchObject({
      processed: 0,
      total: 0,
      isComplete: true,
    });
  } finally {
    restore();
  }
});
