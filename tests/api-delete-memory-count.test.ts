import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Two deletes of the same memory at the same time both find the row. Only the one that
// removes it may take one from the shard's row count.

const scopeHash = "e1e2e3e4e5e6e7e8";
const containerTag = `opencode_project_${scopeHash}`;
let baseDir: string | undefined;

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
  baseDir = undefined;
});

describe("api handlers: memory delete and the shard count", () => {
  it("takes one from the count when two deletes of one memory run at once", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "api-delete-count-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    CONFIG.embeddingDimensions = 8;
    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");

    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const vector = new Float32Array(8);
    vector[0] = 1;
    for (const id of ["mem_gone", "mem_kept"]) {
      await tursoVectorSearch.insertVector(db, {
        id,
        content: `memory ${id}`,
        vector,
        containerTag,
        createdAt: 1000,
        updatedAt: 1000,
      });
    }
    await tursoShardManager.setVectorCount(shard.id, 2);

    const { handleDeleteMemory } = await import("../src/services/api-handlers.js");
    await Promise.all([handleDeleteMemory("mem_gone"), handleDeleteMemory("mem_gone")]);

    const [after] = await tursoShardManager.getAllShards("project", scopeHash);
    expect(after?.vectorCount).toBe(1);
    expect(await tursoVectorSearch.getMemoryById(db, "mem_kept")).toBeTruthy();
  });
});
