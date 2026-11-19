import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the two migrations that rewrite shard files: the project path migration
// and the embedding re-embed. Each test builds an old-shape shard tree with a raw libSQL
// client (shard files on disk, no registry, no sidecars, no marker), runs the migration
// through its public service, and reads every result back with a raw client.

const OLD_HASH = "0a1b2c3d4e5f6071";
const OLD_TAG = `omms_project_${OLD_HASH}`;
const MIGRATION_TIMEOUT = 20000;

const { CONFIG } = await import("../src/config.js");
const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
const { acquireTursoOperationLock } = await import("../src/services/turso/operation-lock.js");
const { getProjectTagInfo } = await import("../src/services/tags.js");

const original = {
  storagePath: CONFIG.storagePath,
  embeddingDimensions: CONFIG.embeddingDimensions,
  embeddingModel: CONFIG.embeddingModel,
  containerTagPrefix: CONFIG.containerTagPrefix,
  maxVectorsPerShard: CONFIG.maxVectorsPerShard,
};
let base: string | undefined;
let restoreEmbedding: (() => void) | undefined;

afterEach(async () => {
  restoreEmbedding?.();
  restoreEmbedding = undefined;
  await cleanupTursoTestDirectory(base);
  base = undefined;
  Object.assign(CONFIG, original);
});

type SeedRow = {
  id: string;
  content: string;
  vector: [number, number];
  tagsVector?: [number, number];
  pinned?: boolean;
  tags?: string;
};

const SHARD_0: SeedRow[] = [
  { id: "mem_a", content: "alpha decision", vector: [1, 0], pinned: true, tags: "one,two" },
  { id: "mem_b", content: "beta decision", vector: [0, 1], tagsVector: [1, 0], tags: "three" },
];
const SHARD_1: SeedRow[] = [
  { id: "mem_c", content: "gamma decision", vector: [0.6, 0.8], pinned: true },
];
const ALL_ROWS = [...SHARD_0, ...SHARD_1];

async function freshStore(): Promise<{ store: string; gonePath: string; newProject: string }> {
  base = mkdtempSync(join(tmpdir(), "omms-shard-migrations-"));
  const store = join(base, "store");
  CONFIG.storagePath = store;
  CONFIG.embeddingDimensions = 2;
  CONFIG.containerTagPrefix = "omms";
  CONFIG.maxVectorsPerShard = 1000;
  await closeTursoAndInvalidateCaches();
  const newProject = join(base, "new-project");
  mkdirSync(newProject, { recursive: true });
  // The old project folder is never created: the shards are orphaned, as after a folder move.
  return { store, gonePath: join(base, "gone-project"), newProject };
}

async function withRawClient<T>(
  path: string,
  fn: (client: ReturnType<typeof createClient>) => Promise<T>
): Promise<T> {
  const client = createClient({ url: pathToFileURL(path).href });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Writes one old-shape shard file with the shard schema of today, through a raw client. */
async function writeOldShard(
  path: string,
  rows: SeedRow[],
  projectPath: string,
  model: string,
  dims = 2
) {
  await withRawClient(path, async (client) => {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS shard_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      {
        sql: `INSERT OR REPLACE INTO shard_metadata (key, value) VALUES ('embedding_dimensions', ?)`,
        args: [String(dims)],
      },
      {
        sql: `INSERT OR REPLACE INTO shard_metadata (key, value) VALUES ('embedding_model', ?)`,
        args: [model],
      },
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, vector F32_BLOB(${dims}) NOT NULL,
        tags_vector F32_BLOB(${dims}), container_tag TEXT NOT NULL, tags TEXT, type TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, metadata TEXT,
        display_name TEXT, user_name TEXT, user_email TEXT, project_path TEXT,
        project_name TEXT, git_repo_url TEXT, is_pinned INTEGER DEFAULT 0)`,
      `CREATE INDEX IF NOT EXISTS idx_container_tag ON memories(container_tag)`,
      `CREATE INDEX IF NOT EXISTS idx_is_pinned ON memories(is_pinned)`,
      `CREATE INDEX IF NOT EXISTS memories_vec_idx ON memories (libsql_vector_idx(vector,
        'metric=cosine', 'compress_neighbors=float8', 'max_neighbors=20'))`,
    ]);
    for (const [index, row] of rows.entries()) {
      await client.execute({
        sql: `INSERT INTO memories (id, content, vector, tags_vector, container_tag, tags, type,
                created_at, updated_at, metadata, display_name, project_path, project_name, is_pinned)
              VALUES (?, ?, vector32(?), ${row.tagsVector ? "vector32(?)" : "NULL"}, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.content,
          JSON.stringify(row.vector),
          ...(row.tagsVector ? [JSON.stringify(row.tagsVector)] : []),
          OLD_TAG,
          row.tags ?? null,
          "decision",
          100 + index,
          200 + index,
          JSON.stringify({ seed: row.id }),
          "Gone Project",
          projectPath,
          "gone-project",
          row.pinned ? 1 : 0,
        ],
      });
    }
  });
}

async function seedOldTree(store: string, projectPath: string, model: string, dims = 2) {
  const projects = join(store, "projects");
  mkdirSync(projects, { recursive: true });
  await writeOldShard(
    join(projects, `project_${OLD_HASH}_shard_0.db`),
    SHARD_0,
    projectPath,
    model,
    dims
  );
  await writeOldShard(
    join(projects, `project_${OLD_HASH}_shard_1.db`),
    SHARD_1,
    projectPath,
    model,
    dims
  );
}

function shardFiles(store: string): string[] {
  const projects = join(store, "projects");
  return readdirSync(projects)
    .filter((name) => name.endsWith(".db"))
    .sort()
    .map((name) => join(projects, name));
}

/** Every memory row across the live shard files, read with a raw client, sorted by ID. */
async function rawMemoryRows(store: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const file of shardFiles(store)) {
    await withRawClient(file, async (client) => {
      const result = await client.execute(
        `SELECT id, content, container_tag, tags, type, created_at, updated_at, metadata,
                project_path, is_pinned, vector_extract(vector) AS v,
                CASE WHEN tags_vector IS NULL THEN NULL ELSE vector_extract(tags_vector) END AS tv
         FROM memories`
      );
      for (const row of result.rows) rows.push({ ...row, file: file.split(/[\\/]/).pop() });
    });
  }
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

const vectorOf = (json: unknown) =>
  (JSON.parse(String(json)) as number[]).map((value) => Math.round(value * 1000) / 1000);

/** Every row of every table in every `.db` file, and a hash of every other file, keyed by path. */
async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".cache" && entry.name !== ".write-locks") await walk(path);
        continue;
      }
      if (/-(wal|shm|journal)$/.test(entry.name)) continue;
      const key = relative(root, path);
      if (!entry.name.endsWith(".db")) {
        snapshot[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
        continue;
      }
      snapshot[key] = await withRawClient(path, async (client) => {
        const tables = await client.execute(
          `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
        );
        const parts: string[] = [];
        for (const table of tables.rows) {
          const name = String(table.name);
          const rows = await client.execute(`SELECT * FROM "${name}"`);
          const encoded = rows.rows.map((row) =>
            JSON.stringify(
              Object.values(row).map((value) =>
                value instanceof ArrayBuffer ? Buffer.from(value).toString("hex") : value
              ),
              (_key, value) => (typeof value === "bigint" ? String(value) : value)
            )
          );
          parts.push(`${name}:${encoded.sort().join("|")}`);
        }
        return parts.join("\n");
      });
    }
  };
  await walk(root);
  return snapshot;
}

/** Registry rows for project shards, read with a raw client. */
async function rawRegistry(store: string) {
  return withRawClient(join(store, "metadata.db"), async (client) => {
    const result = await client.execute(
      `SELECT scope_hash, shard_index, db_path, vector_count FROM shards
       WHERE scope = 'project' ORDER BY scope_hash, shard_index`
    );
    return result.rows.map((row) => ({
      hash: String(row.scope_hash),
      index: Number(row.shard_index),
      file: String(row.db_path).split(/[\\/]/).pop(),
      count: Number(row.vector_count),
    }));
  });
}

/** Replaces the embedder: each content maps back to its seeded vector, tags map to [0, 1]. */
async function stubEmbeddingFromSeeds() {
  const { embeddingService } = await import("../src/services/embedding.js");
  const service = embeddingService as any;
  const saved = {
    warmup: service.warmup,
    clearCache: service.clearCache,
    embedWithTimeout: service.embedWithTimeout,
  };
  const calls: string[] = [];
  service.warmup = async () => {};
  service.clearCache = () => {};
  service.embedWithTimeout = async (text: string) => {
    calls.push(text);
    const row = ALL_ROWS.find((seed) => text.startsWith(seed.content));
    return new Float32Array(row ? row.vector : [0, 1]);
  };
  restoreEmbedding = () => Object.assign(service, saved);
  return calls;
}

describe("shard path migration on an old-shape shard tree", () => {
  it(
    "keeps every row, ID, vector and pin, and only remaps the project fields",
    async () => {
      const { store, gonePath, newProject } = await freshStore();
      await seedOldTree(store, gonePath, CONFIG.embeddingModel);
      const target = getProjectTagInfo(newProject);
      const newHash = target.tag.split("_").pop()!;

      const { shardPathMigrationService } =
        await import("../src/services/storage/maintenance/shard-path-migration-service.js");
      const result = await shardPathMigrationService.migrate({
        currentDirectory: newProject,
        fromHash: OLD_HASH,
      });

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.migratedShards).toBe(2);
      expect(result.migratedMemories).toBe(3);

      const rows = await rawMemoryRows(store);
      expect(rows.map((row) => row.id)).toEqual(["mem_a", "mem_b", "mem_c"]);
      for (const seed of ALL_ROWS) {
        const row = rows.find((candidate) => candidate.id === seed.id)!;
        expect(String(row.content)).toBe(seed.content);
        expect(vectorOf(row.v)).toEqual(seed.vector);
        expect(row.tv == null ? null : vectorOf(row.tv)).toEqual(seed.tagsVector ?? null);
        expect(Number(row.is_pinned)).toBe(seed.pinned ? 1 : 0);
        expect(row.tags ?? null).toBe(seed.tags ?? null);
        expect(String(row.metadata)).toBe(JSON.stringify({ seed: seed.id }));
        expect(String(row.container_tag)).toBe(target.tag);
        expect(String(row.project_path)).toBe(target.projectPath);
        expect(String(row.file)).toContain(newHash);
      }
      expect(shardFiles(store).some((file) => file.includes(OLD_HASH))).toBe(false);
      expect(await rawRegistry(store)).toEqual([
        {
          hash: newHash,
          index: 0,
          file: `project_${newHash}_shard_0.db`,
          count: 2,
        },
        {
          hash: newHash,
          index: 1,
          file: `project_${newHash}_shard_1.db`,
          count: 1,
        },
      ]);
    },
    MIGRATION_TIMEOUT
  );

  it(
    "changes no file on a second run",
    async () => {
      const { store, newProject } = await freshStore();
      await seedOldTree(store, join(base!, "gone-project"), CONFIG.embeddingModel);
      const { shardPathMigrationService } =
        await import("../src/services/storage/maintenance/shard-path-migration-service.js");
      const options = { currentDirectory: newProject, fromHash: OLD_HASH };
      expect((await shardPathMigrationService.migrate(options)).success).toBe(true);

      const before = await snapshotTree(store);
      const again = await shardPathMigrationService.migrate(options);

      expect(again.success).toBe(false);
      expect(await snapshotTree(store)).toEqual(before);
    },
    MIGRATION_TIMEOUT
  );
});

describe("re-embed migration on an old-shape shard tree", () => {
  it(
    "keeps every row, ID, vector and pin, and a second run changes no file",
    async () => {
      const { store, gonePath } = await freshStore();
      await seedOldTree(store, gonePath, "old-model");
      const calls = await stubEmbeddingFromSeeds();
      CONFIG.embeddingModel = "new-model";

      const { migrationService } =
        await import("../src/services/storage/maintenance/migration-service.js");
      const result = await migrationService.migrateToNewModel("re-embed");

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.reEmbeddedMemories).toBe(3);
      const rows = await rawMemoryRows(store);
      expect(rows.map((row) => row.id)).toEqual(["mem_a", "mem_b", "mem_c"]);
      for (const seed of ALL_ROWS) {
        const row = rows.find((candidate) => candidate.id === seed.id)!;
        expect(String(row.content)).toBe(seed.content);
        expect(vectorOf(row.v)).toEqual(seed.vector);
        expect(Number(row.is_pinned)).toBe(seed.pinned ? 1 : 0);
        expect(row.tags ?? null).toBe(seed.tags ?? null);
        expect(String(row.container_tag)).toBe(OLD_TAG);
        expect(String(row.metadata)).toBe(JSON.stringify({ seed: seed.id }));
        expect(Number(row.created_at)).toBeGreaterThanOrEqual(100);
      }
      expect(await rawRegistry(store)).toEqual([
        { hash: OLD_HASH, index: 0, file: `project_${OLD_HASH}_shard_0.db`, count: 2 },
        { hash: OLD_HASH, index: 1, file: `project_${OLD_HASH}_shard_1.db`, count: 1 },
      ]);

      const before = await snapshotTree(store);
      const callsBefore = calls.length;
      const again = await migrationService.migrateToNewModel("re-embed");

      expect(again.success).toBe(true);
      expect(again.reEmbeddedMemories).toBe(0);
      expect(calls.length).toBe(callsBefore);
      expect(await snapshotTree(store)).toEqual(before);
    },
    MIGRATION_TIMEOUT
  );
});

describe("dimension-change preflight", () => {
  it(
    "reports the size change without changing any file",
    async () => {
      const { store, gonePath } = await freshStore();
      await seedOldTree(store, gonePath, CONFIG.embeddingModel);
      const { migrationService } =
        await import("../src/services/storage/maintenance/migration-service.js");
      expect((await migrationService.detectDimensionMismatch()).needsMigration).toBe(false);

      const before = await snapshotTree(store);
      CONFIG.embeddingDimensions = 4;
      const mismatch = await migrationService.detectDimensionMismatch();

      expect(mismatch.needsMigration).toBe(true);
      expect(mismatch.configDimensions).toBe(4);
      expect(
        mismatch.shardMismatches
          .map((shard) => [shard.dbPath.split(/[\\/]/).pop(), shard.storedDimensions])
          .sort()
      ).toEqual([
        [`project_${OLD_HASH}_shard_0.db`, 2],
        [`project_${OLD_HASH}_shard_1.db`, 2],
      ]);
      expect(await snapshotTree(store)).toEqual(before);
    },
    MIGRATION_TIMEOUT
  );

  it(
    "refuses both strategies while another storage operation runs, and changes no file",
    async () => {
      const { store, gonePath } = await freshStore();
      await seedOldTree(store, gonePath, CONFIG.embeddingModel);
      const { migrationService } =
        await import("../src/services/storage/maintenance/migration-service.js");
      await migrationService.detectDimensionMismatch();
      const before = await snapshotTree(store);
      CONFIG.embeddingDimensions = 4;
      await stubEmbeddingFromSeeds();

      const release = acquireTursoOperationLock("other-operation");
      try {
        for (const strategy of ["re-embed", "fresh-start"] as const) {
          const result = await migrationService.migrateToNewModel(strategy);
          expect(result.success).toBe(false);
          expect(result.error).toContain("other-operation");
          expect(migrationService.getStatus().isRunning).toBe(false);
        }
      } finally {
        release();
      }
      const after = await snapshotTree(store);
      expect(after).toEqual(before);
    },
    MIGRATION_TIMEOUT
  );
});

describe("shard inventory follows the active store", () => {
  it(
    "reads the storage path on every call",
    async () => {
      const first = await freshStore();
      await seedOldTree(first.store, first.gonePath, CONFIG.embeddingModel);
      const { shardInventoryService } =
        await import("../src/services/storage/maintenance/shard-inventory-service.js");
      const listedA = await shardInventoryService.listShards(first.newProject);
      expect(listedA.storagePath).toBe(first.store);
      expect(listedA.shards.find((group) => group.scopeHash === OLD_HASH)?.memoryCount).toBe(3);

      const otherStore = join(base!, "other-store");
      CONFIG.storagePath = otherStore;
      await closeTursoAndInvalidateCaches();
      const listedB = await shardInventoryService.listShards(first.newProject);
      expect(listedB.storagePath).toBe(otherStore);
      expect(listedB.shards.some((group) => group.scopeHash === OLD_HASH)).toBe(false);
      expect(shardFiles(first.store).map((file) => file.split(/[\\/]/).pop())).toEqual([
        `project_${OLD_HASH}_shard_0.db`,
        `project_${OLD_HASH}_shard_1.db`,
      ]);
      expect(readdirSync(otherStore).some((name) => name === "projects")).toBe(false);
    },
    MIGRATION_TIMEOUT
  );
});
