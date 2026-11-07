import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";

// One process, two space folders. Every manager is bound to its own root, so a
// write through root A must land only in folder A (design D1).
describe("space-bound store roots", () => {
  const HASH_A = "aa11bb22cc33dd44";
  const HASH_B = "ee55ff66aa77bb88";
  let scratch = "";
  let folderA = "";
  let folderB = "";

  afterEach(async () => {
    await cleanupTursoTestDirectory(scratch);
    await removeTestDir(folderA);
    await removeTestDir(folderB);
  });

  it("keeps two roots apart in one process", async () => {
    scratch = mkdtempSync(join(tmpdir(), "space-roots-scratch-"));
    folderA = mkdtempSync(join(tmpdir(), "space-roots-a-"));
    folderB = mkdtempSync(join(tmpdir(), "space-roots-b-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = scratch;
    CONFIG.embeddingDimensions = 4;

    const { TursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { TursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");

    const connectionsA = new TursoConnectionManager(createClient, () => [folderA]);
    const shardsA = new TursoShardManager({ root: () => folderA, connections: connectionsA });
    const connectionsB = new TursoConnectionManager(createClient, () => [folderB]);
    const shardsB = new TursoShardManager({ root: () => folderB, connections: connectionsB });

    try {
      const writeMemory = async (
        shards: TursoShardManager,
        connections: TursoConnectionManager,
        hash: string,
        id: string
      ) => {
        const shard = await shards.getWriteShard("project", hash);
        const db = await connections.getConnection(shard.dbPath);
        await tursoVectorSearch.insertVector(db, {
          id,
          content: `memory of ${id}`,
          vector: new Float32Array([1, 0, 0, 0]),
          containerTag: `omms_project_${hash}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await shards.incrementVectorCount(shard.id);
      };

      await writeMemory(shardsA, connectionsA, HASH_A, "space_root_a");
      await writeMemory(shardsB, connectionsB, HASH_B, "space_root_b");

      // Each root finds only its own memory.
      const idsAt = async (
        shards: TursoShardManager,
        connections: TursoConnectionManager,
        hash: string
      ) => {
        const shardList = await shards.getAllShards("project", hash);
        expect(shardList).toHaveLength(1);
        const db = await connections.getConnection(shardList[0]!.dbPath);
        const rows = await db.all("SELECT id FROM memories ORDER BY id");
        return rows.map((row) => String(row.id));
      };
      expect(await idsAt(shardsA, connectionsA, HASH_A)).toEqual(["space_root_a"]);
      expect(await idsAt(shardsB, connectionsB, HASH_B)).toEqual(["space_root_b"]);

      // A scope of the other root is unknown here.
      await expect(shardsA.getAllShards("project", HASH_B)).resolves.toEqual([]);
      await expect(shardsB.getAllShards("project", HASH_A)).resolves.toEqual([]);

      // The files sit in their own folders and nowhere else.
      expect(existsSync(join(folderA, "metadata.db"))).toBe(true);
      expect(existsSync(join(folderB, "metadata.db"))).toBe(true);
      expect(existsSync(join(folderA, "projects", `project_${HASH_A}_shard_0.db`))).toBe(true);
      expect(existsSync(join(folderB, "projects", `project_${HASH_B}_shard_0.db`))).toBe(true);
      expect(existsSync(join(folderA, "projects", `project_${HASH_B}_shard_0.db`))).toBe(false);
      expect(existsSync(join(folderB, "projects", `project_${HASH_A}_shard_0.db`))).toBe(false);
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      await connectionsA.closeAll();
      await connectionsB.closeAll();
    }
  });

  it("refuses a database outside its allowed roots", async () => {
    folderA = mkdtempSync(join(tmpdir(), "space-roots-a-"));
    folderB = mkdtempSync(join(tmpdir(), "space-roots-b-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = mkdtempSync(join(tmpdir(), "space-roots-scratch-"));
    scratch = CONFIG.storagePath;

    const { TursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const connections = new TursoConnectionManager(createClient, () => [folderA]);
    await expect(connections.getConnection(join(folderB, "metadata.db"))).rejects.toThrow(
      /outside storagePath/
    );
    await connections.closeAll();
  });
});
