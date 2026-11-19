import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the memory storage surface, shards and search parts (storage port
// slice M0). Real stores in their own folders under the test storage path. Results are
// compared with today's engine path on the same rows; the search golden test checks the
// same IDs come back in the same order.
const { CONFIG } = await import("../src/config.js");
const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const shards = await import("../src/services/storage/memory/shards.js");
const search = await import("../src/services/storage/memory/search.js");
type ShardInfo = import("../src/services/storage/memory/types.js").ShardInfo;
type MemoryRecord = import("../src/services/storage/memory/types.js").MemoryRecord;

const HASH = "0a1b2c3d4e5f6071";
const TAG = `opencode_project_${HASH}`;
const USER_HASH = "9f8e7d6c5b4a3921";
const rootPath = CONFIG.storagePath;
const savedMaxVectors = CONFIG.maxVectorsPerShard;
const folders: string[] = [];

async function freshStore(): Promise<string> {
  mkdirSync(rootPath, { recursive: true });
  const folder = mkdtempSync(join(rootPath, "memory-shards-"));
  folders.push(folder);
  CONFIG.storagePath = folder;
  await resetStoreHandles();
  return folder;
}

afterEach(async () => {
  CONFIG.storagePath = rootPath;
  CONFIG.maxVectorsPerShard = savedMaxVectors;
  await resetStoreHandles();
});
afterAll(async () => {
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
});

async function rawRegistry(folder: string) {
  const raw = createClient({ url: `file:${join(folder, "metadata.db")}` });
  try {
    const result = await raw.execute(
      "SELECT scope, scope_hash, shard_index, db_path, vector_count, is_active FROM shards ORDER BY id"
    );
    return result.rows.map((row) => ({ ...row }));
  } finally {
    raw.close();
  }
}

function unit(axis: number, nudgeAxis?: number, nudge = 0): Float32Array {
  const v = new Float32Array(CONFIG.embeddingDimensions);
  v[axis] = 1;
  if (nudgeAxis !== undefined) v[nudgeAxis] = nudge;
  return v;
}

async function insert(shard: ShardInfo, rec: Partial<MemoryRecord> & { id: string }) {
  const now = Date.now();
  await tursoVectorSearch.insertVector(await tursoConnectionManager.getConnection(shard.dbPath), {
    content: `content ${rec.id}`,
    vector: unit(0),
    containerTag: TAG,
    createdAt: now,
    updatedAt: now,
    ...rec,
  });
}

describe("memory shards surface", () => {
  it("(r) ensureMemoryStoreReady opens the registry; hasMemoryRegistry sees it", async () => {
    const folder = await freshStore();
    expect(shards.hasMemoryRegistry()).toBe(false);
    await shards.ensureMemoryStoreReady();
    expect(shards.hasMemoryRegistry()).toBe(true);
    expect(existsSync(join(folder, "metadata.db"))).toBe(true);
  });

  it("(r) the shard lists match the engine, in each scope order", async () => {
    await freshStore();
    await shards.createMemoryShard("project", HASH, 0);
    await shards.createMemoryShard("project", HASH, 1);
    await shards.createMemoryShard("user", USER_HASH, 0);
    const project = await tursoShardManager.getAllShards("project", "");
    const user = await tursoShardManager.getAllShards("user", "");
    expect(await shards.listMemoryShards("project", "")).toEqual(project);
    expect(await shards.listMemoryShards("project", HASH)).toEqual(
      await tursoShardManager.getAllShards("project", HASH)
    );
    expect(await shards.listMemoryShards("user", "nope0000nope0000")).toEqual([]);
    expect(await shards.listEveryMemoryShard("user")).toEqual([...user, ...project]);
    expect(await shards.listEveryMemoryShard("project")).toEqual([...project, ...user]);
    expect(project.map((s) => s.shardIndex)).toEqual([0, 1]);
  });

  it("(w) createMemoryShard registers the shard and its file under the active folder", async () => {
    const folder = await freshStore();
    const shard = await shards.createMemoryShard("project", HASH, 0);
    expect(shard.dbPath).toBe(join(folder, "projects", `project_${HASH}_shard_0.db`));
    expect(existsSync(shard.dbPath)).toBe(true);
    expect(await rawRegistry(folder)).toEqual([
      {
        scope: "project",
        scope_hash: HASH,
        shard_index: 0,
        db_path: `projects/project_${HASH}_shard_0.db`,
        vector_count: 0,
        is_active: 1,
      },
    ]);
  });

  it("(r) getActiveMemoryShard and getWriteMemoryShard match the engine, rollover included", async () => {
    const folder = await freshStore();
    expect(await shards.getActiveMemoryShard("project", HASH)).toBeNull();
    const first = await shards.getWriteMemoryShard("project", HASH);
    expect(first.shardIndex).toBe(0);
    expect(await shards.getActiveMemoryShard("project", HASH)).toEqual(
      await tursoShardManager.getActiveShard("project", HASH)
    );
    CONFIG.maxVectorsPerShard = 1;
    await insert(first, { id: "fill" });
    const second = await shards.getWriteMemoryShard("project", HASH);
    expect(second.shardIndex).toBe(1);
    expect(await shards.getWriteMemoryShard("project", HASH)).toEqual(
      await tursoShardManager.getWriteShard("project", HASH)
    );
    expect((await rawRegistry(folder)).map((r) => [r.shard_index, r.is_active])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("(w) the count functions write the registry row", async () => {
    const folder = await freshStore();
    const shard = await shards.createMemoryShard("project", HASH, 0);
    await shards.incrementShardCount(shard.id);
    await shards.incrementShardCount(shard.id);
    expect((await rawRegistry(folder))[0]?.vector_count).toBe(2);
    await shards.decrementShardCount(shard.id);
    expect((await rawRegistry(folder))[0]?.vector_count).toBe(1);
    await shards.setShardCount(shard.id, 7);
    expect((await rawRegistry(folder))[0]?.vector_count).toBe(7);
  });

  it("withMemoryScopeWriteLock runs writers of one scope one at a time", async () => {
    await freshStore();
    const events: string[] = [];
    const writer = (name: string) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([
      shards.withMemoryScopeWriteLock("project", HASH, writer("a")),
      shards.withMemoryScopeWriteLock("project", HASH, writer("b")),
    ]);
    expect(results).toEqual(["a", "b"]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("acquireMemoryOperationLock takes the store lock in the active folder", async () => {
    const folder = await freshStore();
    const release = shards.acquireMemoryOperationLock("m0-test");
    try {
      expect(existsSync(join(folder, ".turso-operation.lock"))).toBe(true);
      expect(() => shards.acquireMemoryOperationLock("again")).toThrow(/in progress/);
    } finally {
      release();
    }
    expect(existsSync(join(folder, ".turso-operation.lock"))).toBe(false);
  });

  it("closeAllStoreConnectionsSync drops every pooled connection", async () => {
    await freshStore();
    const shard = await shards.createMemoryShard("project", HASH, 0);
    const before = await tursoConnectionManager.getConnection(shard.dbPath);
    shards.closeAllStoreConnectionsSync();
    const after = await tursoConnectionManager.getConnection(shard.dbPath);
    expect(after).not.toBe(before);
  });

  it("(s) follows a space switch: each space keeps its own shards and files", async () => {
    const spaceA = await freshStore();
    const shardA = await shards.getWriteMemoryShard("project", HASH);
    await insert(shardA, { id: "in_a" });
    await shards.incrementShardCount(shardA.id);

    const spaceB = mkdtempSync(join(rootPath, "memory-shards-"));
    folders.push(spaceB);
    CONFIG.storagePath = spaceB;
    await resetStoreHandles();
    expect(shards.hasMemoryRegistry()).toBe(false);
    expect(await shards.listEveryMemoryShard("user")).toEqual([]);
    expect(existsSync(join(spaceB, "metadata.db"))).toBe(true);
    const shardB = await shards.getWriteMemoryShard("project", HASH);
    expect(shardB.dbPath.startsWith(spaceB)).toBe(true);
    await insert(shardB, { id: "in_b" });

    CONFIG.storagePath = spaceA;
    await resetStoreHandles();
    const back = await shards.listMemoryShards("project", HASH);
    expect(back.map((s) => s.dbPath)).toEqual([shardA.dbPath]);
    expect(back[0]?.vectorCount).toBe(1);
    expect(readdirSync(join(spaceA, "projects"))).toEqual([`project_${HASH}_shard_0.db`]);
    expect(readdirSync(join(spaceB, "projects"))).toEqual([`project_${HASH}_shard_0.db`]);
    const raw = createClient({ url: `file:${shardA.dbPath}` });
    const ids = (await raw.execute("SELECT id FROM memories")).rows.map((r) => r.id);
    raw.close();
    expect(ids).toEqual(["in_a"]);
  });
});

describe("memory search surface: golden results", () => {
  async function seedTwoShards() {
    // The nudge sits on axis 1, so it stays inside the vector whatever the shared test
    // home's embedding dimensions are. Without it every vector ties and order is shard order.
    expect(CONFIG.embeddingDimensions).toBeGreaterThan(1);
    await freshStore();
    const s0 = await shards.createMemoryShard("project", HASH, 0);
    const s1 = await shards.createMemoryShard("project", HASH, 1);
    // Similarity falls with the nudge, so the plain order is n1, n2, ... across both shards.
    await insert(s0, { id: "n1", vector: unit(0, 1, 0.1), content: "notes about lunch" });
    await insert(s1, { id: "n2", vector: unit(0, 1, 0.3), content: "release flow notes" });
    await insert(s0, { id: "n3", vector: unit(0, 1, 0.5), content: "we chose postgres" });
    await insert(s1, { id: "n4", vector: unit(0, 1, 0.7), content: "caching with redis" });
    await insert(s0, { id: "other", vector: unit(0, 1, 0.2), containerTag: "x_project_ab" });
    await insert(s1, {
      id: "mem",
      vector: unit(0, 1, 0.15),
      type: "memorisation",
      content: "postgres memorisation",
    });
    return [s0, s1];
  }

  const ids = (results: Array<{ id: string }>) => results.map((r) => r.id);

  it("searchMemoryShards returns the engine's results, IDs and order, for each argument set", async () => {
    const list = await seedTwoShards();
    const q = unit(0);
    const cases: Array<Parameters<typeof search.searchMemoryShards>> = [
      [list, q, TAG, 10, 0],
      [list, q, TAG, 2, 0],
      [list, q, TAG, 10, 0.99],
      [list, q, "", 10, 0],
      [list, q, TAG, 10, 0, "postgres", 0.3],
      [list, q, TAG, 10, 0, "postgres", 0.3, "rrf"],
      [list, q, TAG, 10, 0, "postgres", 0, "boost", undefined, "memorisation"],
    ];
    for (const args of cases) {
      const engine = await tursoVectorSearch.searchAcrossShards(...args);
      expect(await search.searchMemoryShards(...args)).toEqual(engine);
    }
    // The golden orders themselves, so a change to both paths shows too.
    expect(ids((await search.searchMemoryShards(list, q, TAG, 10, 0)).results)).toEqual([
      "n1",
      "n2",
      "n3",
      "n4",
    ]);
    expect(
      ids((await search.searchMemoryShards(list, q, TAG, 10, 0, "postgres", 0.3)).results)[0]
    ).toBe("n3");
    expect(ids((await search.searchMemoryShards(list, q, "", 10, 0)).results)).toEqual([
      "n1",
      "other",
      "n2",
      "n3",
      "n4",
    ]);
    expect(
      ids(
        (
          await search.searchMemoryShards(
            list,
            q,
            TAG,
            10,
            0,
            "",
            0,
            "boost",
            undefined,
            "memorisation"
          )
        ).results
      )
    ).toEqual(["mem"]);
  });

  it("searchMemoryShards reads through a given opener", async () => {
    const list = await seedTwoShards();
    const opened: string[] = [];
    const open = (dbPath: string) => {
      opened.push(dbPath);
      return tursoConnectionManager.getConnection(dbPath);
    };
    const out = await search.searchMemoryShards(list, unit(0), TAG, 10, 0, "", 0, "boost", open);
    expect(ids(out.results)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(opened.sort()).toEqual(list.map((s) => s.dbPath).sort());
  });

  it("searchMemoryShard returns the engine's single-shard results", async () => {
    const [s0] = await seedTwoShards();
    const q = unit(0);
    const cases: Array<Parameters<typeof search.searchMemoryShard>> = [
      [s0!, q, TAG, 10],
      [s0!, q, TAG, 1],
      [s0!, q, "", 10],
      [s0!, q, TAG, 10, "postgres", 0.3],
      [s0!, q, TAG, 10, "postgres", 0.3, "rrf"],
    ];
    for (const args of cases) {
      expect(await search.searchMemoryShard(...args)).toEqual(
        await tursoVectorSearch.searchInShard(...args)
      );
    }
    expect(ids(await search.searchMemoryShard(s0!, q, TAG, 10))).toEqual(["n1", "n3"]);
    expect(ids(await search.searchMemoryShard(s0!, q, TAG, 10, "postgres", 0.3))[0]).toBe("n3");
  });
});
