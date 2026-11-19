import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";

/**
 * Characterisation of space transfer, import and export before the storage-port move (SP2).
 * Rows are read back with a raw libsql client, never through the code under change.
 */

const PROJECT_HASH_ONE = "aaaaaaaaaaaaaaaa";
const PROJECT_HASH_TWO = "bbbbbbbbbbbbbbbb";
const USER_HASH = "cccccccccccccccc";
const IMPORT_USER_TAG = "omms_user_1122334455667788";
const MODEL = "Xenova/nomic-embed-text-v1";
const DIMS = 4;
const WHOLE_RANGE = { since: 10_000, until: 40_000 };

interface SeedRow {
  id: string;
  text: string;
  scope: "user" | "project";
  hash: string;
  createdAt: number;
  tags?: string;
  type?: string;
  pinned?: boolean;
  metadata?: string;
  projectName?: string;
}

/** a-three sits outside WHOLE_RANGE, so a transfer never selects it. */
const ALPHA_ROWS: SeedRow[] = [
  {
    id: "a-one",
    text: "port probe one",
    scope: "project",
    hash: PROJECT_HASH_ONE,
    createdAt: 10_000,
    tags: "alpha,first",
    type: "note",
    pinned: true,
    metadata: '{"origin":"alpha"}',
    projectName: "Alpha Project",
  },
  {
    id: "a-two",
    text: "port probe two",
    scope: "user",
    hash: USER_HASH,
    createdAt: 20_000,
    tags: "personal",
  },
  {
    id: "a-three",
    text: "port probe three",
    scope: "project",
    hash: PROJECT_HASH_ONE,
    createdAt: 5_000,
  },
  {
    id: "a-four",
    text: "port probe four",
    scope: "project",
    hash: PROJECT_HASH_TWO,
    createdAt: 30_000,
    pinned: true,
    type: "decision",
  },
];

const BETA_ROWS: SeedRow[] = [
  { id: "b-one", text: "beta own row", scope: "project", hash: PROJECT_HASH_ONE, createdAt: 8_000 },
];

function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else
        hashes.set(
          relative(folder, full),
          createHash("sha256").update(readFileSync(full)).digest("hex")
        );
    }
  };
  walk(folder);
  return hashes;
}

async function seed(folder: string, rows: SeedRow[]): Promise<void> {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { openSpaceStore } = await import("../src/services/storage/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    for (const row of rows) {
      const shard = await store.shards.getWriteShard(row.scope, row.hash);
      const db = await store.connections.getConnection(shard.dbPath);
      await tursoVectorSearch.insertVector(db, {
        id: row.id,
        content: row.text,
        vector: new Float32Array([1, 0, 0, 0]),
        tagsVector: row.tags ? new Float32Array([0, 1, 0, 0]) : undefined,
        containerTag: `omms_${row.scope}_${row.hash}`,
        tags: row.tags,
        type: row.type,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        metadata: row.metadata,
        projectName: row.projectName,
      });
      if (row.pinned) await db.run(`UPDATE memories SET is_pinned = 1 WHERE id = ?`, [row.id]);
      await store.shards.incrementVectorCount(shard.id);
    }
  } finally {
    await store.close();
  }
}

/** Opens a file with a raw client, runs `use`, and closes it. */
async function withRaw<T>(
  path: string,
  use: (client: ReturnType<typeof createClient>) => Promise<T>
): Promise<T> {
  const client = createClient({ url: `file:${path}` });
  try {
    return await use(client);
  } finally {
    client.close();
  }
}

/** Every shard file of a space folder, from its metadata.db, read raw. */
async function shardRegistry(folder: string) {
  return withRaw(join(folder, "metadata.db"), async (client) => {
    const result = await client.execute(
      `SELECT scope, scope_hash, db_path, vector_count FROM shards ORDER BY scope, scope_hash, shard_index`
    );
    return result.rows.map((row) => ({
      key: `${String(row.scope)}:${String(row.scope_hash)}`,
      file: join(folder, `${String(row.scope)}s`, String(row.db_path).split(/[\\/]/).pop()!),
      count: Number(row.vector_count),
    }));
  });
}

async function shardCounts(folder: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const shard of await shardRegistry(folder)) counts[shard.key] = shard.count;
  return counts;
}

/** Every memory row with every stored field, vectors as text, sorted by id. */
async function rawRows(folder: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const shard of await shardRegistry(folder)) {
    await withRaw(shard.file, async (client) => {
      const result = await client.execute(
        `SELECT id, content, container_tag, tags, type, created_at, updated_at, metadata,
                project_name, is_pinned, vector_extract(vector) AS v,
                CASE WHEN tags_vector IS NULL THEN NULL ELSE vector_extract(tags_vector) END AS tv
           FROM memories`
      );
      for (const row of result.rows) rows.push({ ...row, shard: shard.key });
    });
  }
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

describe("space transfer, import and export characterisation", () => {
  let tmp = "";
  let alpha = "";
  let beta = "";

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "space-port-char-"));
    alpha = join(tmp, "spaces", "alpha");
    beta = join(tmp, "spaces", "beta");
    mkdirSync(alpha, { recursive: true });
    mkdirSync(beta, { recursive: true });
    writeFileSync(
      join(tmp, "spaces.json"),
      JSON.stringify({
        version: 1,
        activeSpaceId: "default",
        spaces: [
          { id: "alpha", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z", archived: false },
          { id: "beta", name: "Beta", createdAt: "2026-01-02T00:00:00.000Z", archived: false },
        ],
      })
    );
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(tmp, "default-store");
    CONFIG.embeddingModel = MODEL;
    CONFIG.embeddingDimensions = DIMS;
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory();
    if (tmp) await removeTestDir(tmp);
  });

  async function apply(mode: "copy" | "move", embed?: (text: string) => Promise<Float32Array>) {
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    const { applySpaceTransfer } = await import("../src/services/spaces/transfer-service.js");
    return applySpaceTransfer(
      { from: "alpha", to: "beta", filter: WHOLE_RANGE, mode },
      {
        files: spaceFiles(tmp),
        paths: { globalStoragePath: join(tmp, "default-store"), spacesRoot: join(tmp, "spaces") },
        embedding: { model: MODEL, dimensions: DIMS },
        maxVectorsPerShard: 100,
        embed: embed ?? (async () => new Float32Array([0, 1, 0, 0])),
      }
    );
  }

  async function reset(): Promise<void> {
    await cleanupTursoTestDirectory();
    for (const folder of [alpha, beta]) {
      rmSync(folder, { recursive: true, force: true });
      mkdirSync(folder, { recursive: true });
    }
    await seed(alpha, ALPHA_ROWS);
    await seed(beta, BETA_ROWS);
  }

  it("a move writes the same target as a copy and removes exactly the copied rows", async () => {
    await reset();
    const sourceBefore = await rawRows(alpha);
    const alphaHash = hashFolder(alpha);

    const copied = await apply("copy");
    expect(copied).toMatchObject({ ok: true, result: { ok: true, copied: 3, removed: 0 } });
    // A copy leaves the source byte-identical.
    expect(hashFolder(alpha)).toEqual(alphaHash);
    const targetAfterCopy = await rawRows(beta);
    const targetCountsAfterCopy = await shardCounts(beta);

    await reset();
    const moved = await apply("move");
    expect(moved).toMatchObject({ ok: true, result: { ok: true, copied: 3, removed: 3 } });

    const targetAfterMove = await rawRows(beta);
    expect(targetAfterMove).toEqual(targetAfterCopy);
    expect(await shardCounts(beta)).toEqual(targetCountsAfterCopy);
    expect(targetCountsAfterCopy).toEqual({
      "project:aaaaaaaaaaaaaaaa": 2,
      "project:bbbbbbbbbbbbbbbb": 1,
      "user:cccccccccccccccc": 1,
    });

    // Fields, pins and vectors arrive unchanged.
    const one = targetAfterMove.find((row) => row.id === "a-one")!;
    expect(one).toMatchObject({
      content: "port probe one",
      tags: "alpha,first",
      type: "note",
      metadata: '{"origin":"alpha"}',
      project_name: null,
      is_pinned: 1,
      v: "[1,0,0,0]",
      tv: "[0,1,0,0]",
    });
    expect(targetAfterMove.find((row) => row.id === "a-four")).toMatchObject({
      is_pinned: 1,
      type: "decision",
      tv: null,
    });

    // The source keeps every row the move did not select, unchanged.
    const movedIds = new Set(["a-one", "a-two", "a-four"]);
    expect(await rawRows(alpha)).toEqual(
      sourceBefore.filter((row) => !movedIds.has(String(row.id)))
    );
    expect(await shardCounts(alpha)).toEqual({
      "project:aaaaaaaaaaaaaaaa": 1,
      "project:bbbbbbbbbbbbbbbb": 0,
      "user:cccccccccccccccc": 0,
    });
  });

  it("a move that fails while writing keeps the written batches and leaves the source rows", async () => {
    await reset();
    // Without a recorded model the vectors are not reusable, so every row is embedded again.
    for (const shard of await shardRegistry(alpha)) {
      await withRaw(shard.file, (client) =>
        client.execute(`DELETE FROM shard_metadata WHERE key = 'embedding_model'`)
      );
    }
    const sourceRows = await rawRows(alpha);
    const sourceCounts = await shardCounts(alpha);
    let calls = 0;
    const outcome = await apply("move", async () => {
      calls++;
      if (calls === 3) throw new Error("embedder down");
      return new Float32Array([0, 1, 0, 0]);
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({ ok: false, copied: 1, removed: 0 });
    expect(outcome.result.error?.step).toBe("write");
    // Today: the user-scope group lands first and stays; no source row is removed.
    expect((await rawRows(beta)).map((row) => row.id)).toEqual(["a-two", "b-one"]);
    expect(await shardCounts(beta)).toEqual({
      "project:aaaaaaaaaaaaaaaa": 1,
      "user:cccccccccccccccc": 1,
    });
    expect(await rawRows(alpha)).toEqual(sourceRows);
    expect(await shardCounts(alpha)).toEqual(sourceCounts);
  });

  it("export then import into a new space keeps memories, pins, types, tags and profile", async () => {
    await reset();
    const { UserProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const { openSpaceStore } = await import("../src/services/storage/space-store.js");
    const profileStore = openSpaceStore(alpha, "write");
    try {
      const manager = new UserProfileManager(alpha, profileStore.connections);
      const data = {
        preferences: [
          {
            category: "Tooling",
            description: "Prefers Bun",
            confidence: 0.9,
            frequency: 3,
            evidence: [],
            lastSeen: 200,
          },
        ],
        patterns: [],
        workflows: [],
      };
      await manager.createProfile("u", "U", "u", "u", data, 7);
    } finally {
      await profileStore.close();
    }

    const { exportSpace } = await import("../src/services/spaces/export-space.js");
    const outPath = join(tmp, "out", "alpha.json");
    const exported = await exportSpace({
      folder: alpha,
      outPath,
      includeProfile: true,
      embeddingModel: MODEL,
      embeddingDimensions: DIMS,
      ommsVersion: "9.9.9-test",
      homePath: "/nonexistent-home",
    });
    expect(exported).toMatchObject({
      written: true,
      counts: { projectMemories: 3, userMemories: 1, profileItems: 1 },
    });
    const document = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(document.profile).toMatchObject({ version: 1, totalPromptsAnalyzed: 7 });
    expect(document.profile.preferences[0]).toMatchObject({ description: "Prefers Bun" });

    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    const { importSpace } = await import("../src/services/spaces/import-space.js");
    const imported = await importSpace({
      filePath: outPath,
      spaceName: "Round",
      files: spaceFiles(tmp),
      embedding: { model: MODEL, dimensions: DIMS },
      embed: async () => new Float32Array([0, 1, 0, 0]),
      user: { userTag: IMPORT_USER_TAG, userName: "sam" },
    });
    expect(imported).toMatchObject({
      ok: true,
      counts: { projectMemories: 3, userMemories: 1, profileItems: 1 },
    });
    const folder = imported.folder!;

    const rows = await rawRows(folder);
    expect(
      rows.map((row) => [row.id, row.container_tag, row.is_pinned, row.type, row.tags])
    ).toEqual([
      ["a-four", "omms_project_bbbbbbbbbbbbbbbb", 1, "decision", null],
      ["a-one", "omms_project_aaaaaaaaaaaaaaaa", 1, "note", "alpha,first"],
      ["a-three", "omms_project_aaaaaaaaaaaaaaaa", 0, null, null],
      ["a-two", IMPORT_USER_TAG, 0, null, "personal"],
    ]);
    expect(rows.find((row) => row.id === "a-one")).toMatchObject({
      metadata: '{"origin":"alpha"}',
      v: "[0,1,0,0]",
      tv: "[0,1,0,0]",
    });
    expect(await shardCounts(folder)).toEqual({
      "project:aaaaaaaaaaaaaaaa": 2,
      "project:bbbbbbbbbbbbbbbb": 1,
      "user:1122334455667788": 1,
    });

    // Today the import starts a fresh profile history: version 1, one "create" changelog.
    await withRaw(join(folder, "user-profiles.db"), async (client) => {
      const profiles = await client.execute(
        `SELECT version, total_prompts_analyzed, profile_data FROM user_profiles`
      );
      expect(profiles.rows).toHaveLength(1);
      expect(Number(profiles.rows[0]!.version)).toBe(1);
      expect(Number(profiles.rows[0]!.total_prompts_analyzed)).toBe(7);
      expect(String(profiles.rows[0]!.profile_data)).toContain("Prefers Bun");
      const changelogs = await client.execute(`SELECT change_type FROM user_profile_changelogs`);
      expect(changelogs.rows.map((row) => row.change_type)).toEqual(["create"]);
    });
  });

  it("refuses an export from a newer format and creates no space", async () => {
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    const { importSpace } = await import("../src/services/spaces/import-space.js");
    const registryBefore = readFileSync(join(tmp, "spaces.json"), "utf-8");
    const result = await importSpace({
      document: { format: "omms-space-export", schemaVersion: 999, memories: [] },
      spaceName: "Future",
      files: spaceFiles(tmp),
      embedding: { model: MODEL, dimensions: DIMS },
      embed: async () => new Float32Array([0, 1, 0, 0]),
      user: { userTag: IMPORT_USER_TAG },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("schema version 999");
    expect(readFileSync(join(tmp, "spaces.json"), "utf-8")).toBe(registryBefore);
    expect(readdirSync(join(tmp, "spaces")).sort()).toEqual(["alpha", "beta"]);
  });
});
