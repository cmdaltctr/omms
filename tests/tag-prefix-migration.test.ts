import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { CONFIG } from "../src/config.js";
import { extractScopeFromContainerTag } from "../src/services/memory-scope.js";
import { getProjectTagInfo, getUserTagInfo } from "../src/services/tags.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { tursoShardManager } from "../src/services/turso/shard-manager.js";
import { tursoVectorSearch } from "../src/services/turso/vector-search.js";
import type { MemoryRecord, ShardInfo } from "../src/services/turso/types.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const tagPrefixMigrationUrl = new URL("../src/services/tag-prefix-migration.js", import.meta.url)
  .href;
const HASH_A = "0123456789abcdef";
const HASH_B = "fedcba9876543210";

let storePath = "";
let originalConfig: {
  storagePath: string;
  containerTagPrefix: string;
  embeddingDimensions: number;
};

async function migrationModule() {
  return import(tagPrefixMigrationUrl);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

function backupDirectories(): string[] {
  const backups = join(dirnameOf(storePath), "backups");
  if (!existsSync(backups)) return [];
  return readdirSync(backups)
    .map((name) => join(backups, name))
    .filter((path) => statSync(path).isDirectory())
    .sort();
}

function dirnameOf(path: string): string {
  return join(path, "..");
}

async function setupStore(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "tag-prefix-migration-"));
  storePath = join(base, "store");
  originalConfig = {
    storagePath: CONFIG.storagePath,
    containerTagPrefix: CONFIG.containerTagPrefix,
    embeddingDimensions: CONFIG.embeddingDimensions,
  };
  CONFIG.storagePath = storePath;
  CONFIG.containerTagPrefix = "opencode";
  CONFIG.embeddingDimensions = 4;
}

async function seedShard(
  scope: "user" | "project",
  scopeHash: string,
  containerTags: string[]
): Promise<ShardInfo> {
  let shard!: ShardInfo;
  await tursoShardManager.withScopeWriteLock(scope, scopeHash, async () => {
    shard = await tursoShardManager.createShard(scope, scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    await db.transaction("write", async (tx) => {
      for (const [index, containerTag] of containerTags.entries()) {
        const id = `${scope}-${scopeHash}-${index}-${containerTag.startsWith("custom_") ? "custom" : "old"}`;
        const record: MemoryRecord = {
          id,
          content: `memory ${id}`,
          vector: new Float32Array([index + 1, 2, 3, 4]),
          tagsVector: new Float32Array([4, 3, 2, index + 1]),
          containerTag,
          tags: `tag-${index},stable`,
          type: scope,
          createdAt: 1000 + index,
          updatedAt: 2000 + index,
          metadata: JSON.stringify({ index, stable: true }),
          displayName: `display-${scope}`,
          userName: `name-${scope}`,
          userEmail: `${scope}@example.test`,
          projectPath: `/projects/${scopeHash}`,
          projectName: `project-${scopeHash}`,
          gitRepoUrl: `https://example.test/${scopeHash}.git`,
        };
        await tursoVectorSearch.insertVectorInTransaction(tx, record);
        await tx.execute({ sql: "UPDATE memories SET is_pinned = 1 WHERE id = ?", args: [id] });
      }
    });
  });
  return shard;
}

async function dumpRows(shard: ShardInfo): Promise<Array<Record<string, unknown>>> {
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  return db.all(`
    SELECT id, content, hex(vector) AS vector_hex, hex(tags_vector) AS tags_vector_hex,
           container_tag, tags, type, created_at, updated_at, metadata, display_name,
           user_name, user_email, project_path, project_name, git_repo_url, is_pinned
    FROM memories
    ORDER BY id
  `);
}

function expectedOmmsRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    container_tag: String(row.container_tag).replace(/^opencode_/, "omms_"),
  }));
}

async function markerValue(shard: ShardInfo): Promise<unknown> {
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  return (await db.get("SELECT value FROM shard_metadata WHERE key = 'tag_prefix_migration'"))
    ?.value;
}

function verifyManifest(backupPath: string): void {
  const manifest = JSON.parse(readFileSync(join(backupPath, "manifest.json"), "utf-8")) as {
    files?: Array<{ path: string; size: number; sha256: string }>;
  };
  expect(Array.isArray(manifest.files)).toBe(true);
  for (const entry of manifest.files ?? []) {
    const copied = join(backupPath, entry.path);
    expect(statSync(copied).size).toBe(entry.size);
    expect(sha256(copied)).toBe(entry.sha256);
  }
}

afterEach(async () => {
  const base = storePath ? dirnameOf(storePath) : undefined;
  await cleanupTursoTestDirectory(base);
  if (originalConfig) {
    CONFIG.storagePath = originalConfig.storagePath;
    CONFIG.containerTagPrefix = originalConfig.containerTagPrefix;
    CONFIG.embeddingDimensions = originalConfig.embeddingDimensions;
  }
  storePath = "";
});

describe("tag prefix migration surface inventory", () => {
  it("one config default builds the tag shapes and parsing is prefix-agnostic", async () => {
    await setupStore();
    const home = join(dirnameOf(storePath), "clean-home");
    const probe = join(dirnameOf(storePath), "config-default-probe.mjs");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      probe,
      `import { CONFIG, getExplicitContainerTagPrefix } from ${JSON.stringify(
        new URL("../src/config.js", import.meta.url).href
      )}; console.log("CONFIG_RESULT:" + JSON.stringify({ prefix: CONFIG.containerTagPrefix, explicit: getExplicitContainerTagPrefix() ?? null }));`,
      "utf-8"
    );
    const env = { ...process.env, HOME: home, OMMS_SKIP_LEGACY_MIGRATION: "1" };
    delete env.XDG_CONFIG_HOME;
    const probeResult = Bun.spawnSync(["bun", "run", probe], { env });
    const probeOutput = probeResult.stdout.toString().match(/CONFIG_RESULT:(.*)$/m);
    expect(probeResult.exitCode).toBe(0);
    expect(probeOutput).not.toBeNull();
    expect(JSON.parse(probeOutput![1])).toEqual({ prefix: "omms", explicit: null });

    const projectDir = join(storePath, "project");
    mkdirSync(projectDir, { recursive: true });
    for (const prefix of ["omms", "opencode"]) {
      CONFIG.containerTagPrefix = prefix;
      const project = getProjectTagInfo(projectDir);
      const user = getUserTagInfo(projectDir);
      expect(project.tag).toMatch(new RegExp(`^${prefix}_project_[a-f0-9]{16}$`));
      expect(user.tag).toMatch(new RegExp(`^${prefix}_user_[a-f0-9]{16}$`));
    }

    CONFIG.containerTagPrefix = "omms";
    const hash = getProjectTagInfo(projectDir).tag.split("_").at(-1)!;
    expect(extractScopeFromContainerTag(`omms_project_${hash}`)).toEqual({
      scope: "project",
      hash,
    });
  });

  it("shard registration and file names carry no prefix", async () => {
    await setupStore();
    const path = tursoShardManager.getShardPath("project", HASH_A, 0);
    expect(basename(path)).toBe(`project_${HASH_A}_shard_0.db`);

    await tursoShardManager.createShard("project", HASH_A, 0);
    const metadata = await tursoConnectionManager.getConnection(join(storePath, "metadata.db"));
    const row = await metadata.get("SELECT db_path FROM shards WHERE scope_hash = ?", [HASH_A]);
    expect(String(row?.db_path)).not.toContain("opencode");
  });

  it("the import ledger stores no container tag prefix", async () => {
    await setupStore();
    const shard = await seedShard("project", HASH_A, [`opencode_project_${HASH_A}`]);
    const shardDb = await tursoConnectionManager.getConnection(shard.dbPath);
    const tables = await shardDb.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const tablesWithContainerTag: string[] = [];
    for (const { name } of tables) {
      const columns = await shardDb.all<{ name: string }>(
        `PRAGMA table_info('${name.replaceAll("'", "''")}')`
      );
      if (columns.some((column) => column.name === "container_tag"))
        tablesWithContainerTag.push(name);
    }
    expect(tablesWithContainerTag).toEqual(["memories"]);

    // A bare store has no profile or ledger database. Any such store-local database
    // must still be free of the container tag column.
    for (const path of listFiles(storePath).filter(
      (path) => path.endsWith(".db") && path !== shard.dbPath
    )) {
      const db = await tursoConnectionManager.getConnection(path);
      const tablesInDb = await db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      );
      for (const { name } of tablesInDb) {
        const columns = await db.all<{ name: string }>(
          `PRAGMA table_info('${name.replaceAll("'", "''")}')`
        );
        expect(columns.map((column) => column.name)).not.toContain("container_tag");
      }
    }
  });
});

describe("tag prefix migration", () => {
  it("rewrites every opencode_ row across project and user shards with vectors and metadata byte-identical", async () => {
    await setupStore();
    const project = await seedShard("project", HASH_A, Array(3).fill(`opencode_project_${HASH_A}`));
    const user = await seedShard("user", HASH_B, [
      `opencode_user_${HASH_B}`,
      `opencode_user_${HASH_B}`,
      `custom_user_${HASH_B}`,
    ]);
    const beforeProject = await dumpRows(project);
    const beforeUser = await dumpRows(user);
    const projectFileBefore = readFileSync(project.dbPath);
    const userFileBefore = readFileSync(user.dbPath);

    const migration = await migrationModule();
    const result = await migration.runTagPrefixMigration();
    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") throw new Error("migration did not report rewritten shards");
    expect(result.rowsRewritten).toBe(5);
    expect(result.shardsRewritten).toBe(2);
    expect(result.shardsScanned).toBe(2);
    expect(result.shards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dbPath: project.dbPath,
          scope: "project",
          scopeHash: HASH_A,
          rewritten: 3,
          skipped: false,
        }),
        expect.objectContaining({
          dbPath: user.dbPath,
          scope: "user",
          scopeHash: HASH_B,
          rewritten: 2,
          skipped: false,
        }),
      ])
    );
    expect(await dumpRows(project)).toEqual(expectedOmmsRows(beforeProject));
    expect(await dumpRows(user)).toEqual(expectedOmmsRows(beforeUser));
    const completion = await migration.readTagPrefixMigrationCompletion(storePath);
    expect(completion).toEqual(
      expect.objectContaining({
        backupPath: result.backupPath,
        shardsRewritten: 2,
        rowsRewritten: 5,
      })
    );
    expect(await markerValue(project)).toBeTruthy();
    expect(await markerValue(user)).toBeTruthy();

    expect(result.backupPath).toStartWith(join(dirnameOf(storePath), "backups", "tag-prefix-"));
    expect(existsSync(result.backupPath)).toBe(true);
    verifyManifest(result.backupPath);
    expect(readFileSync(join(result.backupPath, relative(storePath, project.dbPath)))).toEqual(
      projectFileBefore
    );
    expect(readFileSync(join(result.backupPath, relative(storePath, user.dbPath)))).toEqual(
      userFileBefore
    );
  });

  it("rollback restores the backed-up opencode_ store for an opencode override", async () => {
    await setupStore();
    const shard = await seedShard("project", HASH_A, [`opencode_project_${HASH_A}`]);
    const migration = await migrationModule();
    const result = await migration.runTagPrefixMigration();
    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") throw new Error("migration did not create a restore point");

    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();
    rmSync(storePath, { recursive: true, force: true });
    cpSync(result.backupPath, storePath, { recursive: true });
    CONFIG.containerTagPrefix = "opencode";

    const restored = await tursoShardManager.getAllShards("project", HASH_A);
    expect(restored).toHaveLength(1);
    const restoredDb = await tursoConnectionManager.getConnection(restored[0]!.dbPath);
    expect(await tursoVectorSearch.countVectors(restoredDb, `opencode_project_${HASH_A}`)).toBe(1);
    expect((await dumpRows(restored[0]!))[0]?.container_tag).toBe(`opencode_project_${HASH_A}`);
    expect(existsSync(join(result.backupPath, "manifest.json"))).toBe(true);
    expect(basename(restored[0]!.dbPath)).toBe(basename(shard.dbPath));
  });

  it("rerun after completion is a no-op", async () => {
    await setupStore();
    const shard = await seedShard("project", HASH_A, [`opencode_project_${HASH_A}`]);
    const migration = await migrationModule();
    await migration.runTagPrefixMigration();
    await tursoConnectionManager.closeConnection(shard.dbPath);
    const backupsBefore = backupDirectories();
    const hashBefore = sha256(shard.dbPath);

    expect((await migration.runTagPrefixMigration()).status).toBe("already-migrated");
    expect(backupDirectories()).toEqual(backupsBefore);
    expect(sha256(shard.dbPath)).toBe(hashBefore);
  });

  it("a crash between the last shard rewrite and the marker write completes without rewriting", async () => {
    await setupStore();
    const shard = await seedShard("project", HASH_A, [`opencode_project_${HASH_A}`]);
    const migration = await migrationModule();
    await migration.runTagPrefixMigration();
    await tursoConnectionManager.closeConnection(shard.dbPath);
    const hashBefore = sha256(shard.dbPath);
    const metadata = await tursoConnectionManager.getConnection(join(storePath, "metadata.db"));
    await metadata.run("DELETE FROM tag_prefix_migration");

    expect((await migration.runTagPrefixMigration()).status).toBe("not-needed");
    expect(await migration.readTagPrefixMigrationCompletion(storePath)).not.toBeNull();
    expect(sha256(shard.dbPath)).toBe(hashBefore);
  });

  it("resumes remaining shards without duplicating or skipping", async () => {
    await setupStore();
    const shardA = await seedShard("project", HASH_A, Array(2).fill(`opencode_project_${HASH_A}`));
    const shardB = await seedShard("project", HASH_B, Array(3).fill(`opencode_project_${HASH_B}`));
    const migration = await migrationModule();
    await migration.runTagPrefixMigration();

    const dbB = await tursoConnectionManager.getConnection(shardB.dbPath);
    await dbB.run(
      "UPDATE memories SET container_tag = REPLACE(container_tag, 'omms_', 'opencode_')"
    );
    await dbB.run("DELETE FROM shard_metadata WHERE key = 'tag_prefix_migration'");
    const metadata = await tursoConnectionManager.getConnection(join(storePath, "metadata.db"));
    await metadata.run("DELETE FROM tag_prefix_migration");
    await tursoConnectionManager.closeConnection(shardA.dbPath);
    const shardAHash = sha256(shardA.dbPath);

    const result = await migration.runTagPrefixMigration();
    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") throw new Error("migration did not resume");
    expect(result.rowsRewritten).toBe(3);
    expect(sha256(shardA.dbPath)).toBe(shardAHash);
    expect(await migration.countOpencodePrefixedRows(storePath)).toBe(0);
    expect(await markerValue(shardA)).toBeTruthy();
    expect(await markerValue(shardB)).toBeTruthy();
  });

  it("backup failure aborts with nothing rewritten", async () => {
    await setupStore();
    await seedShard("project", HASH_A, Array(2).fill(`opencode_project_${HASH_A}`));
    const blocker = join(dirnameOf(storePath), "backups");
    writeFileSync(blocker, "block backup directory creation");
    const migration = await migrationModule();

    await expect(migration.runTagPrefixMigration()).rejects.toThrow();
    expect(await migration.countOpencodePrefixedRows(storePath)).toBe(2);
    expect(await migration.readTagPrefixMigrationCompletion(storePath)).toBeNull();
    rmSync(blocker, { force: true });
  });

  it("shard verification failure rolls back that shard and aborts; already-migrated shards remain valid", async () => {
    await setupStore();
    const shard = await seedShard("project", HASH_A, Array(2).fill(`opencode_project_${HASH_A}`));
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    await db.run(`
      CREATE TRIGGER block_rewrite BEFORE UPDATE ON memories
      WHEN new.container_tag LIKE 'omms\\_%' ESCAPE '\\'
      BEGIN SELECT RAISE(ABORT, 'injected'); END
    `);
    const migration = await migrationModule();

    await expect(migration.runTagPrefixMigration()).rejects.toThrow(basename(shard.dbPath));
    const rows = await dumpRows(shard);
    expect(rows.map((row) => row.container_tag)).toEqual(
      Array(2).fill(`opencode_project_${HASH_A}`)
    );
    expect(await migration.readTagPrefixMigrationCompletion(storePath)).toBeNull();
    const backups = backupDirectories();
    expect(backups).toHaveLength(1);
    verifyManifest(backups[0]!);

    await db.run("DROP TRIGGER block_rewrite");
    expect((await migration.runTagPrefixMigration()).status).toBe("migrated");
  });

  it("startup gate runs before serving and flips reads to omms_", async () => {
    process.env.OMMS_SKIP_TAG_PREFIX_MIGRATION = "1";
    await setupStore();
    const shard = await seedShard("project", HASH_A, [`opencode_project_${HASH_A}`]);
    const { ensureTursoReady, resetTursoReady } = await import("../src/services/turso/ready.js");

    try {
      delete process.env.OMMS_SKIP_TAG_PREFIX_MIGRATION;
      CONFIG.containerTagPrefix = "omms";
      resetTursoReady();
      await ensureTursoReady();
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      expect((await db.get("SELECT container_tag FROM memories"))?.container_tag).toBe(
        `omms_project_${HASH_A}`
      );
      expect(await tursoVectorSearch.countVectors(db, `omms_project_${HASH_A}`)).toBe(1);
    } finally {
      process.env.OMMS_SKIP_TAG_PREFIX_MIGRATION = "1";
      resetTursoReady();
    }
  });

  it("explicitOpencodePrefixWarning warns only for the opencode override", async () => {
    const migration = await migrationModule();
    expect(migration.explicitOpencodePrefixWarning("opencode")).toContain("omms");
    expect(migration.explicitOpencodePrefixWarning(undefined)).toBeNull();
    expect(migration.explicitOpencodePrefixWarning("omms")).toBeNull();
    expect(migration.explicitOpencodePrefixWarning("custom")).toBeNull();
  });

  it("fresh empty store completes as not-needed", async () => {
    await setupStore();
    const migration = await migrationModule();
    expect((await migration.runTagPrefixMigration()).status).toBe("not-needed");
    expect(await migration.readTagPrefixMigrationCompletion(storePath)).not.toBeNull();
    expect((await migration.runTagPrefixMigration()).status).toBe("already-migrated");
  });
});
