import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the three services that delete or bulk-write memories: cleanup,
// deduplication and portability. Every test uses its own temporary store, seeds it through
// the engine and reads the result back with a raw libSQL client, so the checks do not
// depend on the code under test.

const DAY = 24 * 60 * 60 * 1000;
const USER_HASH = "a0a1a2a3a4a5a6a7";
const PROJECT_HASH = "b0b1b2b3b4b5b6b7";
const USER_TAG = `omms_user_${USER_HASH}`;
const PROJECT_TAG = `omms_project_${PROJECT_HASH}`;

const { CONFIG } = await import("../src/config.js");
const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const { acquireTursoOperationLock } = await import("../src/services/turso/operation-lock.js");

const originalStorage = CONFIG.storagePath;
const originalDimensions = CONFIG.embeddingDimensions;
let storage: string | undefined;
let restoreEmbedding: (() => void) | undefined;

afterEach(async () => {
  restoreEmbedding?.();
  restoreEmbedding = undefined;
  await cleanupTursoTestDirectory(storage);
  storage = undefined;
  CONFIG.storagePath = originalStorage;
  CONFIG.embeddingDimensions = originalDimensions;
});

async function freshStore(): Promise<string> {
  storage = mkdtempSync(join(tmpdir(), "omms-memory-maintenance-"));
  CONFIG.storagePath = join(storage, "store");
  CONFIG.embeddingDimensions = 2;
  await closeTursoAndInvalidateCaches();
  return storage;
}

type Seed = {
  id: string;
  at: number;
  type?: string;
  content?: string;
  pinned?: boolean;
  tag?: string;
};

/** Creates shard 0 of a scope and inserts each row, keeping the registry count in step. */
async function seedShard(scope: "user" | "project", hash: string, tag: string, rows: Seed[]) {
  const shard = await tursoShardManager.createShard(scope, hash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  for (const row of rows) {
    await tursoVectorSearch.insertVector(db, {
      id: row.id,
      content: row.content ?? row.id,
      vector: new Float32Array([1, 0]),
      containerTag: row.tag ?? tag,
      type: row.type ?? "discussion",
      createdAt: row.at,
      updatedAt: row.at,
    });
    if (row.pinned) await tursoVectorSearch.pinMemory(db, row.id);
    await tursoShardManager.incrementVectorCount(shard.id);
  }
  return shard;
}

async function withRawClient<T>(
  path: string,
  fn: (client: ReturnType<typeof createClient>) => Promise<T>
) {
  const client = createClient({ url: pathToFileURL(path).href });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** The row IDs in a shard file, sorted, read with a raw client. */
async function rawIds(dbPath: string): Promise<string[]> {
  return withRawClient(dbPath, async (client) => {
    const result = await client.execute("SELECT id FROM memories ORDER BY id");
    return result.rows.map((row) => String(row.id));
  });
}

/** Each shard's registry row count, keyed by shard ID, read with a raw client. */
async function rawRegistryCounts(): Promise<Map<number, number>> {
  return withRawClient(join(CONFIG.storagePath, "metadata.db"), async (client) => {
    const result = await client.execute("SELECT id, vector_count FROM shards");
    return new Map(result.rows.map((row) => [Number(row.id), Number(row.vector_count)]));
  });
}

describe("cleanup characterisation", () => {
  async function seedCleanupStore() {
    await freshStore();
    const now = Date.now();
    const old = now - 40 * DAY;
    const user = await seedShard("user", USER_HASH, USER_TAG, [
      { id: "user-old", at: old },
      { id: "user-fresh", at: now },
      { id: "user-pinned-old", at: old, pinned: true },
      // Same ID as a pinned row in the project shard: the pin protects it here too.
      { id: "pinned-elsewhere", at: old },
    ]);
    const project = await seedShard("project", PROJECT_HASH, PROJECT_TAG, [
      { id: "project-old-1", at: old },
      { id: "project-old-2", at: old },
      { id: "project-just-inside", at: now - 29 * DAY },
      { id: "project-memorisation-old", at: old, type: "memorisation" },
      { id: "pinned-elsewhere", at: now, pinned: true },
    ]);
    CONFIG.autoCleanupRetentionDays = 30;
    return { user, project };
  }

  it("deletes only old unpinned normal rows and lowers each shard count by the same number", async () => {
    const { user, project } = await seedCleanupStore();
    const before = await rawRegistryCounts();
    const { CleanupService } = await import("../src/services/cleanup-service.js");
    const service = new CleanupService();

    expect(await service.countCleanupCandidates(30)).toBe(3);
    const result = await service.runCleanup(CONFIG);

    expect(result.deletedCount).toBe(3);
    expect(result.userCount).toBe(1);
    expect(result.projectCount).toBe(2);
    expect(result.pinnedMemoriesSkipped).toBe(1);
    expect(await rawIds(user.dbPath)).toEqual([
      "pinned-elsewhere",
      "user-fresh",
      "user-pinned-old",
    ]);
    expect(await rawIds(project.dbPath)).toEqual([
      "pinned-elsewhere",
      "project-just-inside",
      "project-memorisation-old",
    ]);
    const after = await rawRegistryCounts();
    expect(before.get(user.id)! - after.get(user.id)!).toBe(1);
    expect(before.get(project.id)! - after.get(project.id)!).toBe(2);
    expect(await service.countCleanupCandidates(30)).toBe(0);
  });

  it("refuses a second manual run while one is in progress", async () => {
    await seedCleanupStore();
    const { CleanupService } = await import("../src/services/cleanup-service.js");
    const service = new CleanupService();
    const first = service.runCleanup(CONFIG);
    await expect(service.runCleanup(CONFIG)).rejects.toThrow("Cleanup already running");
    await first;
  });
});

describe("deduplication characterisation", () => {
  it("deletes exactly the older exact duplicates of normal rows, per tag, and lowers the counts", async () => {
    await freshStore();
    const now = Date.now();
    const user = await seedShard("user", USER_HASH, USER_TAG, [
      { id: "u-new", at: now, content: "same user text" },
      { id: "u-mid", at: now - 1000, content: "same user text" },
      { id: "u-old", at: now - 2000, content: "same user text" },
      { id: "u-other", at: now, content: "different user text" },
    ]);
    const project = await seedShard("project", PROJECT_HASH, PROJECT_TAG, [
      { id: "p-new", at: now, content: "same project text" },
      { id: "p-old", at: now - 1000, content: "same project text" },
      // Same text as the user rows, but another tag: not a duplicate.
      { id: "p-cross", at: now, content: "same user text" },
      // Same text as p-new under the old tag prefix in the same shard: not a duplicate.
      {
        id: "p-legacy",
        at: now - 3000,
        content: "same project text",
        tag: `opencode_project_${PROJECT_HASH}`,
      },
      { id: "ms-new01", at: now, content: "same snapshot", type: "memorisation" },
      { id: "ms-old01", at: now - 1000, content: "same snapshot", type: "memorisation" },
    ]);
    const before = await rawRegistryCounts();
    CONFIG.deduplicationEnabled = true;
    CONFIG.deduplicationSimilarityThreshold = 0.9;

    const { DeduplicationService } = await import("../src/services/deduplication-service.js");
    const result = await new DeduplicationService().detectAndRemoveDuplicates(CONFIG);

    expect(result.exactDuplicatesDeleted).toBe(3);
    expect(await rawIds(user.dbPath)).toEqual(["u-new", "u-other"]);
    expect(await rawIds(project.dbPath)).toEqual([
      "ms-new01",
      "ms-old01",
      "p-cross",
      "p-legacy",
      "p-new",
    ]);
    const after = await rawRegistryCounts();
    expect(before.get(user.id)! - after.get(user.id)!).toBe(2);
    expect(before.get(project.id)! - after.get(project.id)!).toBe(1);
  });

  it("refuses a second run while one is in progress", async () => {
    await freshStore();
    await seedShard("project", PROJECT_HASH, PROJECT_TAG, [{ id: "p-1", at: Date.now() }]);
    CONFIG.deduplicationEnabled = true;
    const { DeduplicationService } = await import("../src/services/deduplication-service.js");
    const service = new DeduplicationService();
    const first = service.detectAndRemoveDuplicates(CONFIG);
    await expect(service.detectAndRemoveDuplicates(CONFIG)).rejects.toThrow(
      "Deduplication already running"
    );
    await first;
  });
});

describe("portability characterisation", () => {
  async function stubEmbedding() {
    const { embeddingService } = await import("../src/services/embedding.js");
    const service = embeddingService as unknown as Record<string, unknown>;
    const original = {
      warmup: service.warmup,
      embedWithTimeout: service.embedWithTimeout,
      isWarmedUp: service.isWarmedUp,
    };
    service.warmup = async () => {
      service.isWarmedUp = true;
    };
    service.embedWithTimeout = async () => new Float32Array([1, 0]);
    restoreEmbedding = () => Object.assign(service, original);
  }

  async function projectDirs(base: string) {
    const source = join(base, "source-project");
    const target = join(base, "target-project");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    const { getProjectTagInfo } = await import("../src/services/tags.js");
    const info = (dir: string) => {
      const tag = getProjectTagInfo(dir);
      return { dir, tag: tag.tag, hash: tag.tag.split("_").pop()! };
    };
    return { source: info(source), target: info(target) };
  }

  function exportDocument(memories: Array<Record<string, unknown>>) {
    return {
      schemaVersion: 1,
      exportedAt: "2026-11-19T00:00:00.000Z",
      plugin: { package: "omms", version: "0.0.0" },
      source: { containerTag: PROJECT_TAG, scope: "project", scopeHash: PROJECT_HASH },
      embedding: { model: "test", dimensions: 2 },
      memories,
    };
  }

  it("round-trips rows of every kind, pins and the shard count", async () => {
    await stubEmbedding();
    const base = await freshStore();
    const { source, target } = await projectDirs(base);
    await seedShard("project", source.hash, source.tag, [
      { id: "rt-pinned", at: 100, pinned: true },
      { id: "rt-plain", at: 200 },
      { id: "rt-ms", at: 300, type: "memorisation" },
    ]);
    const { MemoryPortabilityService } =
      await import("../src/services/memory-portability-service.js");
    const service = new MemoryPortabilityService();
    const outputPath = join(base, "export.json");

    const exported = await service.exportMemories({ currentDirectory: source.dir, outputPath });
    expect(exported.count).toBe(3);
    const imported = await service.importMemories({
      currentDirectory: target.dir,
      inputPath: outputPath,
    });
    expect(imported.success).toBe(true);
    expect(imported.imported).toBe(3);

    const shards = await tursoShardManager.getAllShards("project", target.hash);
    expect(shards).toHaveLength(1);
    const rows = await withRawClient(shards[0]!.dbPath, async (client) => {
      const result = await client.execute(
        "SELECT id, type, is_pinned, container_tag, created_at FROM memories ORDER BY id"
      );
      return result.rows.map((row) => [
        String(row.id),
        String(row.type),
        Number(row.is_pinned),
        String(row.container_tag),
        Number(row.created_at),
      ]);
    });
    expect(rows).toEqual([
      ["rt-ms", "memorisation", 0, target.tag, 300],
      ["rt-pinned", "discussion", 1, target.tag, 100],
      ["rt-plain", "discussion", 0, target.tag, 200],
    ]);
    expect((await rawRegistryCounts()).get(shards[0]!.id)).toBe(3);
  });

  it("rolls back the whole shard transaction when one insert fails, and keeps earlier rows", async () => {
    await stubEmbedding();
    const base = await freshStore();
    const { target } = await projectDirs(base);
    const shard = await seedShard("project", target.hash, target.tag, [
      { id: "already-here", at: 50 },
    ]);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    await db.run(
      `CREATE TRIGGER fail_one_insert BEFORE INSERT ON memories WHEN NEW.id = 'imp-boom'
         BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END`
    );
    const inputPath = join(base, "import.json");
    writeFileSync(
      inputPath,
      JSON.stringify(
        exportDocument([
          { id: "imp-a", content: "first", createdAt: 1, isPinned: true },
          { id: "imp-b", content: "second", createdAt: 2 },
          { id: "imp-boom", content: "third", createdAt: 3 },
        ])
      )
    );
    const { MemoryPortabilityService } =
      await import("../src/services/memory-portability-service.js");

    const result = await new MemoryPortabilityService().importMemories({
      currentDirectory: target.dir,
      inputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("forced insert failure");
    expect(await rawIds(shard.dbPath)).toEqual(["already-here"]);
    expect((await rawRegistryCounts()).get(shard.id)).toBe(1);
  });

  it("does not import while another operation holds the store lock, and releases its own", async () => {
    await stubEmbedding();
    const base = await freshStore();
    const { target } = await projectDirs(base);
    const inputPath = join(base, "import.json");
    writeFileSync(
      inputPath,
      JSON.stringify(exportDocument([{ id: "locked-1", content: "one", createdAt: 1 }]))
    );
    const { MemoryPortabilityService } =
      await import("../src/services/memory-portability-service.js");
    const service = new MemoryPortabilityService();
    // The registry must exist before the lock file goes into the storage folder.
    await tursoShardManager.getAllShards("project", "");

    const release = acquireTursoOperationLock("someone-else");
    try {
      await expect(
        service.importMemories({ currentDirectory: target.dir, inputPath })
      ).rejects.toThrow("migration is in progress");
    } finally {
      release();
    }
    expect(await tursoShardManager.getAllShards("project", target.hash)).toEqual([]);

    const imported = await service.importMemories({ currentDirectory: target.dir, inputPath });
    expect(imported.success).toBe(true);
    // The import released its lock, so a new holder can take it.
    acquireTursoOperationLock("after-import")();
  });
});
