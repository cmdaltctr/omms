import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the memory readers (storage port slice M3). Each reader runs through
// its public API on a real store in its own folder, with rows spread over two shards, so the
// shard walk, the SQL and the result order are all pinned before the readers move onto the
// memory storage surface. Linked reads use two spaces under the test home.
const { CONFIG } = await import("../src/config.js");
const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
type ShardInfo = import("../src/services/turso/types.js").ShardInfo;
type MemoryRecord = import("../src/services/turso/types.js").MemoryRecord;

const HASH = "c3d4e5f60718a1b2";
const TAG = `opencode_project_${HASH}`;
const USER_HASH = "0718a1b2c3d4e5f6";
const USER_TAG = `opencode_user_${USER_HASH}`;
const rootPath = CONFIG.storagePath;
const folders: string[] = [];

/** Points the active store at a new empty folder under the test storage path. */
async function freshStore(): Promise<string> {
  mkdirSync(rootPath, { recursive: true });
  const folder = mkdtempSync(join(rootPath, "memory-readers-"));
  folders.push(folder);
  CONFIG.storagePath = folder;
  await resetStoreHandles();
  return folder;
}

afterEach(async () => {
  CONFIG.storagePath = rootPath;
  await resetStoreHandles();
});

/** A vector on axes 0 and 1 only: the shared test home may set very few dimensions. */
function vector(x: number, y: number): Float32Array {
  const v = new Float32Array(CONFIG.embeddingDimensions);
  v[0] = x;
  v[1] = y;
  return v;
}

function record(id: string, createdAt: number, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    content: `content of ${id}`,
    vector: vector(1, 0.1),
    containerTag: TAG,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

/** Writes one row through the engine and counts it in the registry. */
async function put(shard: ShardInfo, rec: MemoryRecord): Promise<void> {
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  await tursoVectorSearch.insertVector(db, rec);
  await tursoShardManager.incrementVectorCount(shard.id);
}

async function rawGet(dbPath: string, sql: string, args: unknown[] = []) {
  const raw = createClient({ url: `file:${dbPath}` });
  try {
    const result = await raw.execute({ sql, args: args as never });
    return result.rows.map((row) => ({ ...row }));
  } finally {
    raw.close();
  }
}

/** Two project shards and one user shard, with normal rows and memorisations in each. */
async function seedTwoShards() {
  const p0 = await tursoShardManager.createShard("project", HASH, 0);
  const p1 = await tursoShardManager.createShard("project", HASH, 1);
  const u0 = await tursoShardManager.createShard("user", USER_HASH, 0);
  await put(p0, record("n_old", 1000, { tags: "db" }));
  await put(p0, record("n_mid", 3000));
  await put(
    p0,
    record("snap_new", 5000, {
      type: "memorisation",
      tags: "memorisation,ops",
      metadata: JSON.stringify({ memorisation: "snapshot", hostSessionId: "hs-1" }),
    })
  );
  await put(p1, record("n_new", 4000));
  await put(
    p1,
    record("snap_old", 3000, {
      type: "memorisation",
      tags: "memorisation",
      metadata: JSON.stringify({ memorisation: "snapshot", hostSessionId: "hs-1" }),
    })
  );
  await put(
    p1,
    record("label_mem", 2000, {
      type: "memorisation",
      tags: "memorisation,ops",
      metadata: JSON.stringify({ memorisation: "label" }),
    })
  );
  await put(u0, record("u_note", 2500, { containerTag: USER_TAG }));
  await put(u0, record("u_mem", 2600, { containerTag: USER_TAG, type: "memorisation" }));
  return { p0, p1, u0 };
}

afterAll(async () => {
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
});

describe("memorisation store readers", () => {
  it("(r) findSnapshotByHostSession keeps the newest snapshot across shards", async () => {
    await freshStore();
    await seedTwoShards();
    const { findSnapshotByHostSession } = await import("../src/services/memorisation-store.js");
    expect(await findSnapshotByHostSession("hs-1", TAG)).toEqual({ id: "snap_new" });
    expect(await findSnapshotByHostSession("hs-none", TAG)).toBeNull();
    expect(await findSnapshotByHostSession("hs-1", "opencode_project_ffffeeeeddddcccc")).toBeNull();
  });

  it("(r) getMemorisationById and memorisationIdTaken read the active shards by ID", async () => {
    await freshStore();
    await seedTwoShards();
    const store = await import("../src/services/memorisation-store.js");
    const { linkedSettingsFrom } = await import("../src/services/linked-search.js");
    const linked = linkedSettingsFrom(CONFIG);
    expect(await store.getMemorisationById("label_mem", TAG, linked)).toEqual({
      id: "label_mem",
      content: "content of label_mem",
      createdAt: new Date(2000).toISOString(),
      tags: ["ops"],
    });
    expect((await store.getMemorisationById("u_mem", null, linked))?.id).toBe("u_mem");
    expect(await store.getMemorisationById("u_mem", TAG, linked)).toBeNull();
    expect(await store.getMemorisationById("n_new", null, linked)).toBeNull();
    expect(await store.getMemorisationById("missing", null, linked)).toBeNull();
    expect(await store.memorisationIdTaken("snap_old", linked)).toBe(true);
    expect(await store.memorisationIdTaken("n_old", linked)).toBe(false);
    expect(await store.memorisationIdTaken("missing", linked)).toBe(false);
  });

  it("(w) deleteMemorisation removes the row and lowers its shard count only", async () => {
    await freshStore();
    const { p1 } = await seedTwoShards();
    const store = await import("../src/services/memorisation-store.js");
    const { linkedSettingsFrom } = await import("../src/services/linked-search.js");
    const linked = linkedSettingsFrom(CONFIG);
    const metadataDb = join(CONFIG.storagePath, "metadata.db");
    const counts = async () =>
      (await rawGet(metadataDb, "SELECT id, vector_count FROM shards ORDER BY id")).map(
        (row) => `${row.id}:${row.vector_count}`
      );
    const before = await counts();
    expect(await store.deleteMemorisation("n_new", null, linked)).toBe("not-memorisation");
    expect(await store.deleteMemorisation("missing", null, linked)).toBe("not-found");
    expect(await store.deleteMemorisation("label_mem", USER_TAG, linked)).toBe("not-found");
    expect(await counts()).toEqual(before);
    expect(await store.deleteMemorisation("label_mem", TAG, linked)).toBe("deleted");
    expect(await rawGet(p1.dbPath, "SELECT id FROM memories WHERE id = 'label_mem'")).toEqual([]);
    expect(
      (await rawGet(p1.dbPath, "SELECT id FROM memories ORDER BY id")).map((r) => r.id)
    ).toEqual(["n_new", "snap_old"]);
    expect(await counts()).toEqual(
      before.map((entry) => (entry === `${p1.id}:3` ? `${p1.id}:2` : entry))
    );
  });
});

describe("live capture reader", () => {
  it("(r) findLiveCapturedEntryIds is empty with no registry and reads every project shard", async () => {
    const folder = await freshStore();
    const { findLiveCapturedEntryIds } = await import("../src/services/live-captured-entries.js");
    expect([...(await findLiveCapturedEntryIds(HASH, "pi", "hs-9"))]).toEqual([]);
    expect(existsSync(join(folder, "metadata.db"))).toBe(false);

    const p0 = await tursoShardManager.createShard("project", HASH, 0);
    const p1 = await tursoShardManager.createShard("project", HASH, 1);
    const meta = (extra: Record<string, unknown>) =>
      JSON.stringify({ host: "pi", hostSessionId: "hs-9", sourceType: "live-capture", ...extra });
    await put(p0, record("l1", 1000, { metadata: meta({ promptId: "p1" }) }));
    await put(p1, record("l2", 2000, { metadata: meta({ sourceEntryIds: ["e1", "e2", 7] }) }));
    await put(
      p1,
      record("l3", 3000, { metadata: meta({ promptId: "p3", sourceType: "history-import" }) })
    );
    await put(p1, record("l4", 4000, { type: "memorisation", metadata: meta({ promptId: "p4" }) }));
    await put(p0, record("l5", 5000, { metadata: meta({ promptId: "p5", host: "claude" }) }));
    await put(p0, record("l6", 6000, { metadata: meta({ promptId: "p6", hostSessionId: "x" }) }));
    await put(p0, record("l7", 7000, { metadata: "not json" }));
    expect([...(await findLiveCapturedEntryIds(HASH, "pi", "hs-9"))].sort()).toEqual([
      "e1",
      "e2",
      "p1",
    ]);
  });
});

describe("web memory rows", () => {
  it("(r) loadMemoryRows lists normal rows by tag, and every scope without a tag", async () => {
    await freshStore();
    await seedTwoShards();
    const { loadMemoryRows } = await import("../src/services/web-memory-rows.js");
    expect((await loadMemoryRows(TAG)).map((row) => row.id)).toEqual(["n_mid", "n_old", "n_new"]);
    expect((await loadMemoryRows(USER_TAG)).map((row) => row.id)).toEqual(["u_note"]);
    expect((await loadMemoryRows()).map((row) => row.id)).toEqual([
      "n_mid",
      "n_old",
      "n_new",
      "u_note",
    ]);
  });

  it("(r) memorisationIdsAmong finds memorisations in project and user shards", async () => {
    await freshStore();
    await seedTwoShards();
    const web = await import("../src/services/web-memory-rows.js");
    expect(await web.memorisationIdsAmong([])).toEqual([]);
    expect(
      await web.memorisationIdsAmong(["n_old", "snap_new", "label_mem", "u_mem", "u_note", "x"])
    ).toEqual(["snap_new", "label_mem", "u_mem"]);
    expect(await web.webUpdateRefusal("u_mem", {})).toBe(web.MEMORISATION_EDIT_REFUSAL);
    expect(await web.webUpdateRefusal("n_old", {})).toBeUndefined();
    expect(await web.webUpdateRefusal("n_old", { type: "memorisation" })).toBe(
      web.MEMORISATION_TYPE_REFUSAL
    );
  });
});

describe("chat existing-ID check", () => {
  it("(r) existingMemoryIds finds rows of any kind in user and project shards", async () => {
    await freshStore();
    await seedTwoShards();
    const { existingMemoryIds } = await import("../src/services/chat/chat-runtime.js");
    expect([...(await existingMemoryIds([]))]).toEqual([]);
    expect(
      [...(await existingMemoryIds(["n_old", "n_new", "label_mem", "u_note", "u_mem", "x"]))].sort()
    ).toEqual(["label_mem", "n_new", "n_old", "u_mem", "u_note"]);
  });
});

describe("history import duplicate check", () => {
  it("(r) findMemoryIdByImportId reads every project shard and escapes LIKE characters", async () => {
    await freshStore();
    const p0 = await tursoShardManager.createShard("project", HASH, 0);
    const p1 = await tursoShardManager.createShard("project", HASH, 1);
    const withImport = (importId: string) => ({ metadata: JSON.stringify({ importId }) });
    await put(p0, record("i0", 1000, withImport("first")));
    await put(p1, record("i1", 2000, withImport("imp_1%")));
    await put(p1, record("i2", 3000, withImport("impX1Y")));
    await put(p1, record("i3", 4000, withImport("a\\b")));
    await put(p1, record("i4", 5000, withImport("plain")));
    const { findMemoryIdByImportId } = await import("../src/importer/importer.js");
    const cases: Array<[string, string | null]> = [
      ["first", "i0"],
      ["imp_1%", "i1"],
      ["impX1Y", "i2"],
      ["imp_1_", null],
      ["imp%", null],
      ["imp_1Y", null],
      // The stored metadata is JSON, so a backslash is stored doubled. Today's lookup matches
      // the stored text, not the import ID: pinned as is, a refactor must not change it.
      ["a\\b", null],
      ["a\\\\b", "i3"],
      ["plain", "i4"],
      ["missing", null],
    ];
    for (const [importId, expected] of cases) {
      expect(await findMemoryIdByImportId(HASH, importId), importId).toBe(expected);
    }
    expect(await findMemoryIdByImportId("ffffeeeeddddcccc", "first")).toBeNull();
  });
});

// Linked reads: a registry with two spaces under the test home. The active space stays
// Default, so this file changes no other reader's store; the readers take the owner.
const OMMS = join(homedir(), ".omms");
const SPACES_ROOT = join(OMMS, "spaces");
const ALPHA_ID = "readers-alpha";
const BETA_ID = "readers-beta";
const BETA = join(SPACES_ROOT, BETA_ID);
const REGISTRY = join(OMMS, "spaces.json");
const previousRegistry = existsSync(REGISTRY) ? readFileSync(REGISTRY, "utf8") : null;

function writeRegistry(): void {
  const entry = (id: string, name: string, links?: string[]) => ({
    id,
    name,
    createdAt: "2026-11-19T09:00:00.000Z",
    archived: false,
    ...(links ? { links } : {}),
  });
  mkdirSync(join(SPACES_ROOT, ALPHA_ID), { recursive: true });
  mkdirSync(BETA, { recursive: true });
  writeFileSync(
    REGISTRY,
    `${JSON.stringify({
      version: 1,
      activeSpaceId: "default",
      spaces: [entry(ALPHA_ID, "Readers Alpha", [BETA_ID]), entry(BETA_ID, "Readers Beta")],
    })}\n`
  );
}

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

afterAll(async () => {
  const { closeAllCachedSpaceReadStores } =
    await import("../src/services/spaces/read-store-cache.js");
  await closeAllCachedSpaceReadStores();
  rmSync(join(SPACES_ROOT, ALPHA_ID), { recursive: true, force: true });
  rmSync(BETA, { recursive: true, force: true });
  if (previousRegistry === null) rmSync(REGISTRY, { force: true });
  else writeFileSync(REGISTRY, previousRegistry);
});

describe("linked-space readers", () => {
  it("(r) search, list and by-ID reads use the read-only opener, same IDs and order", async () => {
    await freshStore();
    writeRegistry();
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const write = openSpaceStore(BETA, "write");
    try {
      const s0 = await write.shards.createShard("project", HASH, 0);
      const s1 = await write.shards.createShard("project", HASH, 1);
      const insert = async (shard: ShardInfo, rec: MemoryRecord) =>
        tursoVectorSearch.insertVector(await write.connections.getConnection(shard.dbPath), rec);
      await insert(s0, record("b_far", 1000, { vector: vector(0, 1) }));
      await insert(s0, record("b_close", 2000, { vector: vector(1, 0.1) }));
      await insert(s1, record("b_mid", 3000, { vector: vector(1, 0.6) }));
      await insert(s1, record("b_near", 4000, { vector: vector(1, 0.3) }));
      await insert(s1, record("b_mem", 5000, { type: "memorisation", vector: vector(1, 0) }));
      await insert(
        s1,
        record("b_other", 6000, { containerTag: "opencode_project_ffffeeeeddddcccc" })
      );
    } finally {
      await write.close();
    }
    const before = hashFolder(BETA);

    const { getCachedSpaceReadStore } = await import("../src/services/spaces/read-store-cache.js");
    const cached = getCachedSpaceReadStore(BETA);
    const opened: string[] = [];
    const openShard = cached.openShard.bind(cached);
    (cached as { openShard: typeof cached.openShard }).openShard = (dbPath) => {
      opened.push(dbPath);
      return openShard(dbPath);
    };
    const pooled: string[] = [];
    const getConnection = tursoConnectionManager.getConnection.bind(tursoConnectionManager);
    (tursoConnectionManager as any).getConnection = (dbPath: string) => {
      pooled.push(dbPath);
      return getConnection(dbPath);
    };

    try {
      const linked = await import("../src/services/linked-search.js");
      const settings = {
        ...linked.linkedSettingsFrom(CONFIG),
        maxMemories: 10,
        similarityThreshold: 0,
      };
      const owner = { id: ALPHA_ID, customStoragePath: false };

      const search = await linked.searchLinkedSpaces({
        query: "zzqx",
        queryVector: vector(1, 0),
        scope: "project",
        containerTag: TAG,
        ownCount: 1,
        owner,
        settings,
      });
      expect(search.warnings).toEqual([]);
      expect(search.results.map((r) => [r.id, r.spaceName])).toEqual([
        ["b_close", "Readers Beta"],
        ["b_near", "Readers Beta"],
        ["b_mid", "Readers Beta"],
        ["b_far", "Readers Beta"],
      ]);
      const memSearch = await linked.searchLinkedSpaces({
        query: "zzqx",
        queryVector: vector(1, 0),
        scope: "project",
        containerTag: TAG,
        ownCount: 0,
        owner,
        settings,
        kind: "memorisation",
      });
      expect(memSearch.results.map((r) => r.id)).toEqual(["b_mem"]);

      const list = await linked.listLinkedSpaces({
        scope: "project",
        containerTag: TAG,
        limit: 4,
        ownCount: 1,
        owner,
        settings,
      });
      expect(list.warnings).toEqual([]);
      expect(list.memories.map((m) => [m.id, m.spaceName])).toEqual([
        ["b_near", "Readers Beta"],
        ["b_mid", "Readers Beta"],
        ["b_close", "Readers Beta"],
      ]);
      const memList = await linked.listLinkedSpaces({
        scope: "project",
        containerTag: TAG,
        limit: 10,
        ownCount: 0,
        owner,
        settings,
        kind: "memorisation",
      });
      expect(memList.memories.map((m) => m.id)).toEqual(["b_mem"]);
      const all = await linked.listLinkedSpaces({
        scope: "all-projects",
        containerTag: "",
        limit: 10,
        ownCount: 0,
        owner,
        settings,
      });
      expect(all.memories.map((m) => m.id)).toEqual([
        "b_other",
        "b_near",
        "b_mid",
        "b_close",
        "b_far",
      ]);

      expect(await linked.findLinkedMemoryOwner("b_mem", owner, settings)).toEqual({
        name: "Readers Beta",
      });
      expect(await linked.findLinkedMemoryOwner("missing", owner, settings)).toBeNull();
      const read = await linked.readLinkedMemory("b_mem", owner, settings, TAG);
      expect([read?.name, read?.row.id, read?.row.type]).toEqual([
        "Readers Beta",
        "b_mem",
        "memorisation",
      ]);
      expect(await linked.readLinkedMemory("b_other", owner, settings, TAG)).toBeNull();
      expect((await linked.readLinkedMemory("b_other", owner, settings, null))?.row.id).toBe(
        "b_other"
      );
      expect(
        await linked.readLinkedMemory(
          "b_mem",
          { id: "default", customStoragePath: false },
          settings,
          null
        )
      ).toBeNull();
    } finally {
      (tursoConnectionManager as any).getConnection = getConnection;
      (cached as { openShard: typeof cached.openShard }).openShard = openShard;
    }

    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((path) => path.startsWith(BETA))).toBe(true);
    expect(pooled.filter((path) => path.startsWith(BETA))).toEqual([]);
    expect(hashFolder(BETA)).toEqual(before);
  });
});
