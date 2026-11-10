import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string | undefined;

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
  baseDir = undefined;
});

describe("memory export keeps memorisations", () => {
  it("exports a memorisation next to a normal memory (export is kind-neutral)", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "omms-export-kind-"));
    const projectDir = join(baseDir, "project");
    mkdirSync(projectDir, { recursive: true });
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(baseDir, "storage");
    CONFIG.embeddingDimensions = 2;
    CONFIG.containerTagPrefix = "opencode";
    const { getProjectTagInfo } = await import("../src/services/tags.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const tag = getProjectTagInfo(projectDir);
    const hash = tag.tag.split("_").pop()!;
    const shard = await tursoShardManager.createShard("project", hash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    for (const [id, type] of [
      ["mem_normal01", "project"],
      ["ms-snap01", "memorisation"],
    ] as const) {
      await tursoVectorSearch.insertVector(db, {
        id,
        content: `content of ${id}`,
        vector: new Float32Array([1, 0]),
        containerTag: tag.tag,
        type,
        createdAt: 1,
        updatedAt: 1,
      });
    }

    const outputPath = join(baseDir, "memories.json");
    const { memoryPortabilityService } =
      await import("../src/services/memory-portability-service.js");
    const exported = await memoryPortabilityService.exportMemories({
      currentDirectory: projectDir,
      outputPath,
    });
    expect(exported.success).toBe(true);
    const document = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(document.memories.map((memory: { id: string }) => memory.id).sort()).toEqual([
      "mem_normal01",
      "ms-snap01",
    ]);
  });
});
