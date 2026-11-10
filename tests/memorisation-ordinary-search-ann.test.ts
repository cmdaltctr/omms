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

const HASH = "b2c3d4e5f6071829";
const CONTAINER = `omms_project_${HASH}`;
const DIMENSIONS = 8;
/** The ANN candidate count for a project-tag search is max(limit * 16, 128). */
const ANN_CANDIDATES = 128;

describe("ordinary search is not starved by closer memorisations", () => {
  it("returns normal memories up to the limit when more than the ANN candidate count of memorisations are closer", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "omms-ordinary-ann-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    CONFIG.embeddingDimensions = DIMENSIONS;
    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const shard = await tursoShardManager.createShard("project", HASH, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    const query = new Float32Array(DIMENSIONS);
    query[0] = 1;

    // Memorisations sit close to the query. Each one tilts a little, so none is identical.
    for (let index = 0; index < ANN_CANDIDATES + 12; index++) {
      const vector = new Float32Array(DIMENSIONS);
      vector[0] = 1;
      vector[1 + (index % (DIMENSIONS - 1))] = 0.01 * (index + 1);
      await tursoVectorSearch.insertVector(db, {
        id: `ms-near${index}`,
        content: `memorisation ${index}`,
        vector,
        tagsVector: vector,
        containerTag: CONTAINER,
        type: "memorisation",
        tags: "memorisation",
        createdAt: 1000 + index,
        updatedAt: 1000 + index,
      });
    }
    // Four normal memories are farther from the query than every memorisation.
    for (let index = 0; index < 4; index++) {
      const far = new Float32Array(DIMENSIONS);
      far[1] = 1;
      far[2 + index] = 0.1 * (index + 1);
      await tursoVectorSearch.insertVector(db, {
        id: `mem_far${index}`,
        content: `normal ${index}`,
        vector: far,
        tagsVector: far,
        containerTag: CONTAINER,
        type: "discussion",
        tags: "alpha",
        createdAt: 5000 + index,
        updatedAt: 5000 + index,
      });
    }

    const results = await tursoVectorSearch.searchInShard(shard, query, CONTAINER, 3);

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.id.startsWith("mem_far"))).toBe(true);
  }, 60_000);
});
