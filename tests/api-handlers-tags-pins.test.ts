import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

describe("api handlers: tag list and unpin", () => {
  let baseDir: string;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  async function openStore() {
    baseDir = mkdtempSync(join(tmpdir(), "api-tags-pins-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    CONFIG.embeddingDimensions = 768;

    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();

    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const vector = new Float32Array(768);
    vector[0] = 1;

    async function seed(scope: "user" | "project", hash: string, id: string, extra = {}) {
      const shard = await tursoShardManager.createShard(scope, hash, 0);
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      await tursoVectorSearch.insertVector(db, {
        id,
        content: `content of ${id}`,
        vector,
        containerTag: `opencode_${scope}_${hash}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...extra,
      });
      return db;
    }
    return { seed, tursoVectorSearch };
  }

  it("lists project tags with their project details and leaves user tags out", async () => {
    const { seed } = await openStore();
    await seed("project", "a1a2a3a4a5a6a7a8", "mem_tag_project", {
      displayName: "Project display",
      userName: "Ada",
      userEmail: "ada@example.com",
      projectPath: "/work/alpha",
      projectName: "alpha",
      gitRepoUrl: "https://example.com/alpha.git",
    });
    await seed("user", "b1b2b3b4b5b6b7b8", "mem_tag_user");

    const { handleListTags } = await import("../src/services/api-handlers.js");
    const result = await handleListTags();

    expect(result.success).toBe(true);
    expect(result.data?.project).toEqual([
      {
        tag: "opencode_project_a1a2a3a4a5a6a7a8",
        displayName: "Project display",
        userName: "Ada",
        userEmail: "ada@example.com",
        projectPath: "/work/alpha",
        projectName: "alpha",
        gitRepoUrl: "https://example.com/alpha.git",
      },
    ]);
  });

  it("unpins a pinned memory", async () => {
    const { seed, tursoVectorSearch } = await openStore();
    const db = await seed("project", "c1c2c3c4c5c6c7c8", "mem_unpin_1");
    await tursoVectorSearch.pinMemory(db, "mem_unpin_1");
    expect(Number((await tursoVectorSearch.getMemoryById(db, "mem_unpin_1"))?.is_pinned)).toBe(1);

    const { handleUnpinMemory } = await import("../src/services/api-handlers.js");
    const result = await handleUnpinMemory("mem_unpin_1");

    expect(result).toEqual({ success: true });
    expect(Number((await tursoVectorSearch.getMemoryById(db, "mem_unpin_1"))?.is_pinned)).toBe(0);
  });

  it("refuses an empty id and an unknown id when unpinning", async () => {
    await openStore();
    const { handleUnpinMemory } = await import("../src/services/api-handlers.js");

    expect(await handleUnpinMemory("")).toEqual({ success: false, error: "id is required" });
    expect(await handleUnpinMemory("mem_missing")).toEqual({
      success: false,
      error: "Memory not found",
    });
  });
});
