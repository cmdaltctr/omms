import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the tag migrations (storage port slice M5b). It pins what they do today so
// the move into src/services/storage/maintenance/ cannot change it: a failed shard rolls back its
// transaction, the backup manifest keeps its shape, a re-run is a no-op, memorisations are handled
// as before, and each run follows the active store. Every store here is real, in a temp folder.

const prefixUrl = new URL(
  "../src/services/storage/maintenance/tag-prefix-migration.js",
  import.meta.url
).href;
const backfillUrl = new URL("../src/services/storage/maintenance/tag-migration.js", import.meta.url)
  .href;
const HASH_A = "0123456789abcdef";
const HASH_B = "fedcba9876543210";

let bases: string[] = [];
let saved: Record<string, unknown> = {};

async function loadConfig() {
  return (await import("../src/config.js")).CONFIG;
}

async function engine() {
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  return { tursoShardManager, tursoConnectionManager, tursoVectorSearch };
}

/** Points the active store at a new temp folder, as a memory space switch does. */
async function useNewStore(): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), "storage-tag-migrations-"));
  bases.push(base);
  const store = join(base, "store");
  const config = await loadConfig();
  config.storagePath = store;
  const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
  await resetStoreHandles();
  return store;
}

interface Seed {
  id: string;
  containerTag: string;
  type?: string;
  tags?: string;
}

async function seedShard(scope: "user" | "project", scopeHash: string, rows: Seed[]) {
  const { tursoShardManager, tursoConnectionManager, tursoVectorSearch } = await engine();
  const shard = await tursoShardManager.createShard(scope, scopeHash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  for (const [index, row] of rows.entries()) {
    await tursoVectorSearch.insertVector(db, {
      id: row.id,
      content: `content of ${row.id}`,
      vector: new Float32Array([index + 1, 1, 0, 0]),
      tagsVector: new Float32Array([1, index + 1, 0, 0]),
      containerTag: row.containerTag,
      tags: row.tags ?? "",
      type: row.type ?? scope,
      createdAt: 1000 + index,
      updatedAt: 2000 + index,
    });
  }
  return shard;
}

/** Reads every memory row through a second, raw libSQL client, so the test does not trust the store. */
async function rawRows(dbPath: string): Promise<Record<string, unknown>[]> {
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const result = await client.execute(
      `SELECT id, content, hex(vector) AS vector_hex, hex(tags_vector) AS tags_vector_hex,
              container_tag, tags, type, created_at, updated_at, is_pinned
       FROM memories ORDER BY id`
    );
    return result.rows.map((row) => ({ ...row }));
  } finally {
    client.close();
  }
}

async function rawShardMarker(dbPath: string): Promise<unknown> {
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const result = await client.execute(
      "SELECT value FROM shard_metadata WHERE key = 'tag_prefix_migration'"
    );
    return result.rows[0]?.value ?? null;
  } finally {
    client.close();
  }
}

function withPrefix(rows: Record<string, unknown>[], to: string): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    container_tag: String(row.container_tag).replace(/^opencode_/, `${to}_`),
  }));
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function hashTree(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of listFiles(root)) {
    hashes[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  return hashes;
}

async function closeAll(): Promise<void> {
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
}

beforeEach(async () => {
  const config = await loadConfig();
  saved = {
    storagePath: config.storagePath,
    containerTagPrefix: config.containerTagPrefix,
    embeddingDimensions: config.embeddingDimensions,
    memoryProvider: config.memoryProvider,
    memoryModel: config.memoryModel,
    memoryApiUrl: config.memoryApiUrl,
    memoryApiKey: config.memoryApiKey,
  };
  config.embeddingDimensions = 4;
  config.containerTagPrefix = "omms";
});

afterEach(async () => {
  Object.assign(await loadConfig(), saved);
  for (const base of bases) await cleanupTursoTestDirectory(base);
  bases = [];
  const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
  await resetStoreHandles();
});

describe("tag prefix migration (characterisation)", () => {
  it("rolls back a shard that fails after its UPDATE, leaving every row as it was", async () => {
    await useNewStore();
    const shardA = await seedShard("project", HASH_A, [
      { id: "a1", containerTag: `opencode_project_${HASH_A}` },
      { id: "a2", containerTag: `opencode_project_${HASH_A}` },
    ]);
    const shardB = await seedShard("project", HASH_B, [
      { id: "b1", containerTag: `opencode_project_${HASH_B}` },
      { id: "b2", containerTag: `opencode_project_${HASH_B}` },
      { id: "b3", containerTag: `custom_project_${HASH_B}` },
    ]);
    // The rewrite of shard B succeeds; its completion marker, written later in the same
    // transaction, fails. So the transaction, not the statement, must undo the rewrite.
    const { tursoConnectionManager } = await engine();
    const dbB = await tursoConnectionManager.getConnection(shardB.dbPath);
    await dbB.run(`
      CREATE TRIGGER block_marker BEFORE INSERT ON shard_metadata
      WHEN new.key = 'tag_prefix_migration'
      BEGIN SELECT RAISE(ABORT, 'injected'); END
    `);
    const beforeA = await rawRows(shardA.dbPath);
    const beforeB = await rawRows(shardB.dbPath);

    const migration = await import(prefixUrl);
    await expect(migration.runTagPrefixMigration()).rejects.toThrow("rolled back");

    expect(await rawRows(shardB.dbPath)).toEqual(beforeB);
    expect(await rawShardMarker(shardB.dbPath)).toBeNull();
    expect(await rawRows(shardA.dbPath)).toEqual(withPrefix(beforeA, "omms"));
    expect(await rawShardMarker(shardA.dbPath)).toBeTruthy();
    expect(await migration.readTagPrefixMigrationCompletion((await loadConfig()).storagePath)).toBe(
      null
    );

    await dbB.run("DROP TRIGGER block_marker");
    const resumed = await migration.runTagPrefixMigration();
    expect(resumed.status).toBe("migrated");
    expect(resumed.rowsRewritten).toBe(2);
    expect(await rawRows(shardB.dbPath)).toEqual(withPrefix(beforeB, "omms"));
  });

  it("writes a backup manifest of the same shape", async () => {
    const store = await useNewStore();
    const shard = await seedShard("user", HASH_A, [
      { id: "u1", containerTag: `opencode_user_${HASH_A}` },
    ]);
    const migration = await import(prefixUrl);
    const result = await migration.runTagPrefixMigration();
    expect(result.status).toBe("migrated");

    const text = readFileSync(join(result.backupPath, "manifest.json"), "utf-8");
    const manifest = JSON.parse(text);
    expect(text).toBe(JSON.stringify(manifest, null, 2));
    expect(Object.keys(manifest)).toEqual(["createdAt", "kind", "source", "fileCount", "files"]);
    expect(manifest.kind).toBe("tag-prefix-migration");
    expect(manifest.source).toBe(store);
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
    expect(manifest.fileCount).toBe(manifest.files.length);
    for (const entry of manifest.files) {
      expect(Object.keys(entry)).toEqual(["path", "size", "sha256"]);
      expect(entry.path).not.toContain("\\");
      expect(statSync(join(result.backupPath, entry.path)).size).toBe(entry.size);
    }
    const paths = manifest.files.map((entry: { path: string }) => entry.path);
    expect(paths).toContain("metadata.db");
    expect(paths).toContain(relative(store, shard.dbPath).split("\\").join("/"));
  });

  it("changes no file and writes no backup on a re-run", async () => {
    const store = await useNewStore();
    await seedShard("project", HASH_A, [{ id: "p1", containerTag: `opencode_project_${HASH_A}` }]);
    const migration = await import(prefixUrl);
    expect((await migration.runTagPrefixMigration()).status).toBe("migrated");
    await closeAll();
    const backups = join(store, "..", "backups");
    const backupsBefore = readdirSync(backups);
    const shardsBefore = hashTree(join(store, "projects"));

    expect((await migration.runTagPrefixMigration()).status).toBe("already-migrated");
    await closeAll();
    expect(readdirSync(backups)).toEqual(backupsBefore);
    expect(hashTree(join(store, "projects"))).toEqual(shardsBefore);
  });

  it("rewrites memorisation rows' prefix and keeps their tags, type and vectors", async () => {
    await useNewStore();
    const shard = await seedShard("project", HASH_A, [
      { id: "n1", containerTag: `opencode_project_${HASH_A}`, tags: "kept" },
      { id: "m1", containerTag: `opencode_project_${HASH_A}`, type: "memorisation", tags: "" },
      { id: "m2", containerTag: `opencode_project_${HASH_A}`, type: "memorisation", tags: "x,y" },
    ]);
    const before = await rawRows(shard.dbPath);
    const migration = await import(prefixUrl);
    const result = await migration.runTagPrefixMigration();
    expect(result.status).toBe("migrated");
    expect(result.rowsRewritten).toBe(3);
    expect(await rawRows(shard.dbPath)).toEqual(withPrefix(before, "omms"));
  });

  it("(s) acts only on the store active at call time", async () => {
    const storeA = await useNewStore();
    const shardA = await seedShard("project", HASH_A, [
      { id: "a1", containerTag: `opencode_project_${HASH_A}` },
    ]);
    const migration = await import(prefixUrl);
    expect((await migration.runTagPrefixMigration()).status).toBe("migrated");
    await closeAll();
    const filesA = hashTree(join(storeA, ".."));

    const storeB = await useNewStore();
    const shardB = await seedShard("project", HASH_B, [
      { id: "b1", containerTag: `opencode_project_${HASH_B}` },
    ]);
    const result = await migration.runTagPrefixMigration();
    expect(result.status).toBe("migrated");
    expect(result.shardsScanned).toBe(1);
    expect(result.backupPath.startsWith(join(storeB, "..", "backups"))).toBe(true);
    expect(await migration.readTagPrefixMigrationCompletion(storeB)).not.toBeNull();
    expect((await rawRows(shardB.dbPath))[0]?.container_tag).toBe(`omms_project_${HASH_B}`);
    await closeAll();
    expect(hashTree(join(storeA, ".."))).toEqual(filesA);
    expect(existsSync(join(storeA, "projects", `project_${HASH_B}_shard_0.db`))).toBe(false);
    expect(shardA.dbPath.startsWith(storeA)).toBe(true);
  });
});

describe("tag backfill (characterisation)", () => {
  async function stubModel(calls: string[]) {
    const config = await loadConfig();
    Object.assign(config, {
      memoryProvider: "openai-chat",
      memoryModel: "m",
      memoryApiUrl: "https://x.invalid/v1",
      memoryApiKey: "sk-test",
    });
    const { embeddingService } = await import("../src/services/embedding.js");
    const { AIProviderFactory } = await import("../src/services/ai/ai-provider-factory.js");
    const originalEmbed = embeddingService.embedWithTimeout;
    const originalCreate = AIProviderFactory.createProvider;
    embeddingService.embedWithTimeout = (async () =>
      new Float32Array([1, 0, 0, 0])) as typeof originalEmbed;
    AIProviderFactory.createProvider = (() => ({
      executeToolCall: async (_system: string, _prompt: string, _tool: unknown, id: string) => {
        calls.push(id);
        return { success: true, data: { tags: ["bun"] } };
      },
    })) as unknown as typeof originalCreate;
    return () => {
      embeddingService.embedWithTimeout = originalEmbed;
      AIProviderFactory.createProvider = originalCreate;
    };
  }

  it("registers its reset under the same name", async () => {
    await import(backfillUrl);
    const { registeredStoreResets } = await import("../src/services/spaces/store-handles.js");
    expect(registeredStoreResets()).toContain("tag-migration");
  });

  it("neither counts nor tags untagged memorisations", async () => {
    await useNewStore();
    const shard = await seedShard("project", HASH_A, [
      { id: "n1", containerTag: `omms_project_${HASH_A}` },
      { id: "m1", containerTag: `omms_project_${HASH_A}`, type: "memorisation" },
      { id: "m2", containerTag: `omms_project_${HASH_A}`, type: "memorisation", tags: "own" },
    ]);
    const calls: string[] = [];
    const restore = await stubModel(calls);
    try {
      const backfill = await import(backfillUrl);
      const detected = await backfill.handleDetectTagMigration();
      expect(detected.data).toEqual({ needsMigration: true, count: 1 });
      const run = await backfill.runTagMigrationBatch(await loadConfig(), 5);
      expect(run.data).toMatchObject({ processed: 1, total: 1, tagged: 1, failed: 0 });
      expect(calls).toEqual(["migration_n1"]);
      const rows = await rawRows(shard.dbPath);
      expect(rows.map((row) => [row.id, row.tags])).toEqual([
        ["m1", null],
        ["m2", "own"],
        ["n1", "bun"],
      ]);
    } finally {
      restore();
    }
  });

  it("calls no model and changes no row on a run after completion", async () => {
    await useNewStore();
    const shard = await seedShard("project", HASH_A, [
      { id: "n1", containerTag: `omms_project_${HASH_A}` },
      { id: "n2", containerTag: `omms_project_${HASH_A}` },
    ]);
    const calls: string[] = [];
    const restore = await stubModel(calls);
    try {
      const backfill = await import(backfillUrl);
      expect((await backfill.runTagMigrationBatch(await loadConfig(), 5)).data?.tagged).toBe(2);
      const after = await rawRows(shard.dbPath);
      calls.length = 0;

      const again = await backfill.runTagMigrationBatch(await loadConfig(), 5);
      expect(again.data).toMatchObject({ processed: 0, total: 0, tagged: 0, hasMore: false });
      expect(calls).toEqual([]);
      expect(await rawRows(shard.dbPath)).toEqual(after);
      expect((await backfill.handleDetectTagMigration()).data).toEqual({
        needsMigration: false,
        count: 0,
      });
    } finally {
      restore();
    }
  });
});
