import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";

const HASH = "a1b2c3d4e5f60718";
const USER_HASH = "1122334455667788";

/** SHA-256 of every file under `folder`, keyed by its path relative to the folder. */
function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
        hashes.set(relative(folder, full), digest);
      }
    }
  };
  walk(folder);
  return hashes;
}

async function writeOneMemory(folder: string, id: string): Promise<void> {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    const shard = await store.shards.getWriteShard("project", HASH);
    const db = await store.connections.getConnection(shard.dbPath);
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `memory of ${id}`,
      vector: new Float32Array([1, 0, 0, 0]),
      containerTag: `omms_project_${HASH}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await store.shards.incrementVectorCount(shard.id);
  } finally {
    await store.close();
  }
}

describe("space store", () => {
  let folder = "";

  afterEach(async () => {
    await cleanupTursoTestDirectory();
    if (folder) await removeTestDir(folder);
  });

  it("a read open leaves every file byte-identical and refuses writes", async () => {
    folder = mkdtempSync(join(tmpdir(), "space-store-read-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = folder;
    CONFIG.embeddingDimensions = 4;
    await writeOneMemory(folder, "space_store_read_target");

    const before = hashFolder(folder);
    expect(before.size).toBeGreaterThan(0);

    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const read = openSpaceStore(folder, "read");
    expect(read.hasMetadata).toBe(true);

    const shards = await read.listShards("project", HASH);
    expect(shards).toHaveLength(1);
    const db = await read.openShard(shards[0]!.dbPath);
    const rows = await db.all("SELECT id FROM memories");
    expect(rows.map((row) => String(row.id))).toEqual(["space_store_read_target"]);

    const pragma = await db.get("PRAGMA query_only");
    expect(Number((pragma as { query_only?: number } | null)?.query_only)).toBe(1);
    await expect(db.run("DELETE FROM memories")).rejects.toThrow();
    await read.close();

    expect(hashFolder(folder)).toEqual(before);
  });

  it("a read of a missing folder returns an empty space and creates nothing", async () => {
    const missing = join(tmpdir(), `space-store-absent-${process.pid}-${Date.now()}`);
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const read = openSpaceStore(missing, "read");
    expect(read.hasMetadata).toBe(false);
    await expect(read.listShards("project", HASH)).resolves.toEqual([]);
    await expect(read.listShards("user", "")).resolves.toEqual([]);
    await read.close();
    expect(existsSync(missing)).toBe(false);
  });

  it("a write store and a host-style writer on the same folder exclude each other", async () => {
    folder = mkdtempSync(join(tmpdir(), "space-store-lock-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = folder;
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const store = openSpaceStore(folder, "write");

    let active = 0;
    let maximumActive = 0;
    const criticalSection = async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active--;
    };

    try {
      const host = tursoShardManager.withScopeWriteLock("project", HASH, criticalSection);
      const space = store.shards.withScopeWriteLock("project", HASH, criticalSection);
      await Promise.all([host, space]);
    } finally {
      await store.close();
    }

    expect(maximumActive).toBe(1);
    // Both writers used the same lock files, so none is left behind.
    expect(readdirSync(join(folder, ".write-locks"))).toEqual([]);
  });

  it("close() releases the store files", async () => {
    folder = mkdtempSync(join(tmpdir(), "space-store-close-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = folder;
    CONFIG.embeddingDimensions = 4;
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const store = openSpaceStore(folder, "write");
    const shard = await store.shards.getWriteShard("user", USER_HASH);
    await store.connections.getConnection(shard.dbPath);
    await store.close();

    // Windows-safe removal: the retry pattern only succeeds once every handle is gone.
    await removeTestDir(folder);
    expect(existsSync(folder)).toBe(false);
  });
});
