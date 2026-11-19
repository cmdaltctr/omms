import { expect, it, mock } from "bun:test";

// A storage failure inside the scope write lock must come back as a failed
// ApiResponse, the same as any other add failure, not as a rejected promise.

const realEmbedding = await import("../src/services/embedding.js");
const realShards = await import("../src/services/storage/memory/shards.js");
const realRows = await import("../src/services/storage/memory/rows.js");
mock.module("../src/services/embedding.js", () => ({
  ...realEmbedding,
  embeddingService: {
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([0.1, 0.2]),
  },
}));
mock.module("../src/services/storage/memory/shards.js", () => ({
  ...realShards,
  ensureMemoryStoreReady: async () => {},
  getWriteMemoryShard: async () => ({ id: 1 }),
  incrementShardCount: async () => {},
  withMemoryScopeWriteLock: async <T>(_scope: string, _hash: string, fn: () => Promise<T>) => fn(),
}));
mock.module("../src/services/storage/memory/rows.js", () => ({
  ...realRows,
  insertMemoryRow: async () => {
    throw new Error("disk full");
  },
}));
const { handleAddMemory } = await import("../src/services/api/memory-write.js");

it("returns a failed response when the insert fails inside the write lock", async () => {
  const result = await handleAddMemory({
    content: "A memory",
    containerTag: "omms_project_0123456789abcdef",
  }).catch((error: unknown) => ({ rejected: String(error) }));
  expect(result).toEqual({ success: false, error: "Error: disk full" });
});
