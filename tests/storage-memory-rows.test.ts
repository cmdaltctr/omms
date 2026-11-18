import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the memory storage surface, rows part (storage port slice M0). Each
// surface function runs on a real store in its own folder under the test storage path, and
// its result is compared with today's path on the same rows: the engine call, the caller
// function, or the caller's SQL text run through the engine connection.
const { CONFIG } = await import("../src/config.js");
const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const engineUtils = await import("../src/services/turso/vector-utils.js");
const rows = await import("../src/services/storage/memory/rows.js");
type ShardInfo = import("../src/services/storage/memory/types.js").ShardInfo;
type MemoryRecord = import("../src/services/storage/memory/types.js").MemoryRecord;

const HASH = "a1b2c3d4e5f60718";
const TAG = `opencode_project_${HASH}`;
const OTHER_TAG = "opencode_project_ffffeeeeddddcccc";
const rootPath = CONFIG.storagePath;
const folders: string[] = [];

async function freshShard(): Promise<ShardInfo> {
  mkdirSync(rootPath, { recursive: true });
  const folder = mkdtempSync(join(rootPath, "memory-rows-"));
  folders.push(folder);
  CONFIG.storagePath = folder;
  await resetStoreHandles();
  return tursoShardManager.createShard("project", HASH, 0);
}

afterEach(async () => {
  CONFIG.storagePath = rootPath;
  await resetStoreHandles();
});
afterAll(async () => {
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
});

function vector(axis: number, nudge = 0): Float32Array {
  const v = new Float32Array(CONFIG.embeddingDimensions);
  v[0] = 1;
  v[axis] = nudge || 0.1;
  return v;
}

let clock = 1_000_000;
function record(id: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  clock += 1000;
  return {
    id,
    content: `content of ${id}`,
    vector: vector(1 + ((clock / 1000) % 50)),
    containerTag: TAG,
    createdAt: clock,
    updatedAt: clock,
    ...extra,
  };
}

/** Today's write path: the engine insert on the pooled connection. */
async function engineInsert(shard: ShardInfo, rec: MemoryRecord): Promise<void> {
  await tursoVectorSearch.insertVector(
    await tursoConnectionManager.getConnection(shard.dbPath),
    rec
  );
}

async function engineDb(shard: ShardInfo) {
  return tursoConnectionManager.getConnection(shard.dbPath);
}

async function rawRows(shard: ShardInfo, sql: string, args: unknown[] = []) {
  const raw = createClient({ url: `file:${shard.dbPath}` });
  try {
    const result = await raw.execute({ sql, args: args as never });
    return result.rows.map((row) => ({ ...row }));
  } finally {
    raw.close();
  }
}

const plain = (list: Array<Record<string, unknown>>) => list.map((row) => ({ ...row }));

/** A spy opener: records the paths it opens and hands out the pooled connection. */
function spyOpener() {
  const opened: string[] = [];
  const open = (dbPath: string) => {
    opened.push(dbPath);
    return tursoConnectionManager.getConnection(dbPath);
  };
  return { opened, open };
}

async function seed(shard: ShardInfo): Promise<void> {
  await engineInsert(shard, record("m_a", { tags: "db,infra", type: "decision" }));
  await engineInsert(
    shard,
    record("m_b", {
      metadata: JSON.stringify({ sessionID: "ses-1", host: "pi", hostSessionId: "hs-1" }),
    })
  );
  await engineInsert(shard, record("m_other", { containerTag: OTHER_TAG, projectPath: "/p/o" }));
  await engineInsert(
    shard,
    record("mem_1", {
      type: "memorisation",
      tags: "memorisation,ops",
      metadata: JSON.stringify({
        sessionID: "ses-1",
        memorisation: "snapshot",
        hostSessionId: "hs-1",
      }),
    })
  );
  await engineInsert(
    shard,
    record("mem_2", {
      type: "memorisation",
      metadata: JSON.stringify({ memorisation: "snapshot", hostSessionId: "hs-1" }),
    })
  );
}

describe("memory rows surface: by-ID reads and writes", () => {
  it("(r) getMemoryRow matches the engine read, and is null for a missing ID", async () => {
    const shard = await freshShard();
    await seed(shard);
    for (const id of ["m_a", "mem_1", "missing"]) {
      expect(await rows.getMemoryRow(shard, id)).toEqual(
        await tursoVectorSearch.getMemoryById(await engineDb(shard), id)
      );
    }
    expect(await rows.getMemoryRow(shard, "missing")).toBeNull();
    expect((await rows.getMemoryRow(shard, "m_a"))?.content).toBe("content of m_a");
  });

  it("(w) insertMemoryRow stores the same row as the engine insert", async () => {
    const shard = await freshShard();
    const base = record("x", { tags: "a,b", type: "note", isPinned: true, metadata: "{}" });
    base.tagsVector = vector(7);
    await rows.insertMemoryRow(shard, { ...base, id: "via_surface" });
    await engineInsert(shard, { ...base, id: "via_engine" });
    const [surface, engine] = await Promise.all([
      rawRows(shard, "SELECT * FROM memories WHERE id = ?", ["via_surface"]),
      rawRows(shard, "SELECT * FROM memories WHERE id = ?", ["via_engine"]),
    ]);
    expect(surface).toHaveLength(1);
    expect({ ...surface[0], id: "" }).toEqual({ ...engine[0], id: "" });
    // Today's plain insert does not write the pin (only the transaction insert does).
    expect(surface[0]).toMatchObject({ content: "content of x", is_pinned: 0, tags: "a,b" });
  });

  it("(w) deleteMemoryRow removes only that row", async () => {
    const shard = await freshShard();
    await seed(shard);
    await rows.deleteMemoryRow(shard, "m_a");
    const ids = (await rawRows(shard, "SELECT id FROM memories ORDER BY id")).map((r) => r.id);
    expect(ids).toEqual(["m_b", "m_other", "mem_1", "mem_2"]);
  });

  it("(w) pinMemoryRow and unpinMemoryRow set is_pinned", async () => {
    const shard = await freshShard();
    await seed(shard);
    await rows.pinMemoryRow(shard, "m_a");
    expect(await rawRows(shard, "SELECT is_pinned FROM memories WHERE id = 'm_a'")).toEqual([
      { is_pinned: 1 },
    ]);
    await rows.unpinMemoryRow(shard, "m_a");
    expect(await rawRows(shard, "SELECT is_pinned FROM memories WHERE id = 'm_a'")).toEqual([
      { is_pinned: 0 },
    ]);
  });

  it("re-exports the engine's pure vector helpers unchanged", () => {
    expect(rows.formatTagsForEmbedding).toBe(engineUtils.formatTagsForEmbedding);
    expect(rows.parseExtractedVector).toBe(engineUtils.parseExtractedVector);
  });
});

describe("memory rows surface: list reads match the engine", () => {
  it("(r) listMemoryRows matches listMemories for each tag, limit and kind", async () => {
    const shard = await freshShard();
    await seed(shard);
    const db = await engineDb(shard);
    const cases: Array<[string, number, ("normal" | "memorisation")?]> = [
      ["", 10],
      [TAG, 10],
      [TAG, 1],
      [TAG, 10, "memorisation"],
      ["", 10, "normal"],
    ];
    for (const [tag, limit, kind] of cases) {
      expect(plain(await rows.listMemoryRows(shard, tag, limit, kind))).toEqual(
        plain(await tursoVectorSearch.listMemories(db, tag, limit, kind))
      );
    }
    expect((await rows.listMemoryRows(shard, TAG, 10)).map((r) => r.id)).toEqual(["m_b", "m_a"]);
    const spy = spyOpener();
    await rows.listMemoryRows(shard, TAG, 10, "normal", spy.open);
    expect(spy.opened).toEqual([shard.dbPath]);
  });

  it("(r) allMemoryRows matches getAllMemories for normal, memorisation and all", async () => {
    const shard = await freshShard();
    await seed(shard);
    const db = await engineDb(shard);
    expect(plain(await rows.allMemoryRows(shard))).toEqual(
      plain(await tursoVectorSearch.getAllMemories(db))
    );
    for (const kind of ["normal", "memorisation", "all"] as const) {
      expect(plain(await rows.allMemoryRows(shard, kind))).toEqual(
        plain(await tursoVectorSearch.getAllMemories(db, kind))
      );
    }
    expect((await rows.allMemoryRows(shard, "all")).length).toBe(5);
  });

  it("(r) distinctMemoryTags and countMemoryRows match the engine", async () => {
    const shard = await freshShard();
    await seed(shard);
    const db = await engineDb(shard);
    expect(plain(await rows.distinctMemoryTags(shard))).toEqual(
      plain(await tursoVectorSearch.getDistinctTags(db))
    );
    expect(await rows.countMemoryRows(shard)).toBe(await tursoVectorSearch.countAllVectors(db));
    expect(await rows.countMemoryRows(shard)).toBe(5);
  });

  it("(r) sessionMemoryRows matches getMemoriesBySessionID for each kind", async () => {
    const shard = await freshShard();
    await seed(shard);
    const db = await engineDb(shard);
    for (const kind of [undefined, "normal", "memorisation"] as const) {
      expect(await rows.sessionMemoryRows(shard, "ses-1", kind)).toEqual(
        await tursoVectorSearch.getMemoriesBySessionID(db, "ses-1", kind)
      );
    }
    expect((await rows.sessionMemoryRows(shard, "ses-1")).map((r) => r.id)).toEqual(["m_b"]);
  });
});

describe("memory rows surface: transactions", () => {
  it("(w) replaceMemoryRowInShard stores what replaceMemoryRow stores, and rolls back on failure", async () => {
    const shard = await freshShard();
    await engineInsert(shard, record("r_surface", { content: "old" }));
    await engineInsert(shard, record("r_caller", { content: "old" }));
    const fresh = record("x", { content: "new", tags: "t", isPinned: false });
    await rows.replaceMemoryRowInShard(shard, { ...fresh, id: "r_surface" });
    const { replaceMemoryRow } = await import("../src/services/memory-replace.js");
    expect(await replaceMemoryRow({ ...fresh, id: "r_caller" })).toBe(true);
    const [surface, caller] = await Promise.all([
      rawRows(shard, "SELECT * FROM memories WHERE id = 'r_surface'"),
      rawRows(shard, "SELECT * FROM memories WHERE id = 'r_caller'"),
    ]);
    expect({ ...surface[0], id: "" }).toEqual({ ...caller[0], id: "" });
    expect(surface[0]?.content).toBe("new");

    // A vector of the wrong size fails the insert: the delete rolls back with it.
    const broken = { ...fresh, id: "r_surface", content: "lost", vector: new Float32Array(3) };
    await expect(rows.replaceMemoryRowInShard(shard, broken)).rejects.toThrow();
    expect(await rawRows(shard, "SELECT content FROM memories WHERE id = 'r_surface'")).toEqual([
      { content: "new" },
    ]);
  });

  it("(w) insertMemoryRowsInOneTransaction inserts and pins in order, and rolls back as one", async () => {
    const shard = await freshShard();
    const seen: string[] = [];
    await rows.insertMemoryRowsInOneTransaction(
      shard,
      [
        { record: record("t1"), isPinned: false },
        { record: record("t2"), isPinned: true },
      ],
      (id) => seen.push(id)
    );
    expect(seen).toEqual(["t1", "t2"]);
    expect(await rawRows(shard, "SELECT id, is_pinned FROM memories ORDER BY id")).toEqual([
      { id: "t1", is_pinned: 0 },
      { id: "t2", is_pinned: 1 },
    ]);

    // The second item reuses an ID, so the whole batch rolls back, the first item too.
    await expect(
      rows.insertMemoryRowsInOneTransaction(
        shard,
        [
          { record: record("t3"), isPinned: false },
          { record: record("t1"), isPinned: false },
        ],
        () => {}
      )
    ).rejects.toThrow();
    expect((await rawRows(shard, "SELECT id FROM memories ORDER BY id")).map((r) => r.id)).toEqual([
      "t1",
      "t2",
    ]);
  });
});

describe("memory rows surface: caller queries give the caller's answer", () => {
  it("(r) newestSnapshotRow finds what findSnapshotByHostSession finds", async () => {
    const shard = await freshShard();
    await seed(shard);
    const { findSnapshotByHostSession } = await import("../src/services/memorisation-store.js");
    const row = await rows.newestSnapshotRow(shard, TAG, "hs-1");
    expect(row?.id).toBe("mem_2");
    expect(await findSnapshotByHostSession("hs-1", TAG)).toEqual({ id: String(row?.id) });
    expect(await rows.newestSnapshotRow(shard, TAG, "hs-none")).toBeNull();
  });

  it("(r) liveCaptureMetadataRows yields the IDs findLiveCapturedEntryIds yields", async () => {
    const shard = await freshShard();
    // A row with no sourceType never matches today's `!= 'history-import'` test (NULL), so
    // live rows carry one, as live capture writes them.
    const meta = (extra: Record<string, unknown>) =>
      JSON.stringify({ host: "pi", hostSessionId: "hs-9", sourceType: "live-capture", ...extra });
    await engineInsert(shard, record("l1", { metadata: meta({ promptId: "p1" }) }));
    await engineInsert(shard, record("l2", { metadata: meta({ sourceEntryIds: ["e1", "e2"] }) }));
    await engineInsert(
      shard,
      record("l3", { metadata: meta({ promptId: "p3", sourceType: "history-import" }) })
    );
    await engineInsert(
      shard,
      record("l4", { type: "memorisation", metadata: meta({ promptId: "p4" }) })
    );
    await engineInsert(shard, record("l5", { metadata: meta({ promptId: "p5", host: "claude" }) }));
    const found = await rows.liveCaptureMetadataRows(shard, "pi", "hs-9");
    const ids = new Set<string>();
    for (const row of found) {
      const m = JSON.parse(row.metadata) as { promptId?: string; sourceEntryIds?: string[] };
      if (m.promptId) ids.add(m.promptId);
      for (const id of m.sourceEntryIds ?? []) ids.add(id);
    }
    expect([...ids].sort()).toEqual(["e1", "e2", "p1"]);
    const { findLiveCapturedEntryIds } = await import("../src/services/live-captured-entries.js");
    expect([...(await findLiveCapturedEntryIds(HASH, "pi", "hs-9"))].sort()).toEqual(
      [...ids].sort()
    );
  });

  it("(r) memorisationIdsInShard matches memorisationIdsAmong", async () => {
    const shard = await freshShard();
    await seed(shard);
    const ids = ["m_a", "mem_1", "mem_2", "missing"];
    const found = await rows.memorisationIdsInShard(shard, ids);
    expect(found.sort()).toEqual(["mem_1", "mem_2"]);
    const { memorisationIdsAmong } = await import("../src/services/web-memory-rows.js");
    expect((await memorisationIdsAmong(ids)).sort()).toEqual(found);
  });

  it("(r) existingMemoryIdsInShard matches existingMemoryIds", async () => {
    const shard = await freshShard();
    await seed(shard);
    const ids = ["m_a", "mem_1", "missing"];
    const found = await rows.existingMemoryIdsInShard(shard, ids);
    expect(found.sort()).toEqual(["m_a", "mem_1"]);
    const { existingMemoryIds } = await import("../src/services/chat/chat-runtime.js");
    expect([...(await existingMemoryIds(ids))].sort()).toEqual(found);
  });

  it("(r) memoryIdByImportId matches findMemoryIdByImportId, LIKE characters escaped", async () => {
    const shard = await freshShard();
    await engineInsert(shard, record("i1", { metadata: JSON.stringify({ importId: "imp_1%" }) }));
    await engineInsert(shard, record("i2", { metadata: JSON.stringify({ importId: "impX1Y" }) }));
    const { findMemoryIdByImportId } = await import("../src/importer/importer.js");
    for (const [importId, expected] of [
      ["imp_1%", "i1"],
      ["impX1Y", "i2"],
      ["imp_1_", null],
      ["missing", null],
    ] as const) {
      expect(await rows.memoryIdByImportId(shard, importId)).toBe(expected);
      expect(await findMemoryIdByImportId(HASH, importId)).toBe(expected);
    }
  });

  it("(r) dedupCandidateRows, pinnedMemoryIds and memoryRowsUpdatedBefore match the caller SQL", async () => {
    const shard = await freshShard();
    await seed(shard);
    await rows.pinMemoryRow(shard, "m_b");
    await rows.pinMemoryRow(shard, "mem_1");
    const db = await engineDb(shard);
    // Copied from deduplication-service.ts and cleanup-service.ts.
    const dedupSql = `
          SELECT
            id,
            content,
            container_tag,
            created_at,
            vector_extract(vector) AS vector_json
          FROM memories
          WHERE type IS NOT 'memorisation'
          ORDER BY created_at DESC
        `;
    expect(plain(await rows.dedupCandidateRows(shard))).toEqual(plain(await db.all(dedupSql)));
    expect((await rows.dedupCandidateRows(shard)).map((r) => r.id)).toEqual([
      "m_other",
      "m_b",
      "m_a",
    ]);

    const pinned = await db.all(`SELECT id FROM memories WHERE is_pinned = 1`);
    expect(await rows.pinnedMemoryIds(shard)).toEqual(pinned.map((r) => String(r.id)));
    expect((await rows.pinnedMemoryIds(shard)).sort()).toEqual(["m_b", "mem_1"]);

    const cutoff = (await rows.getMemoryRow(shard, "m_other"))!.updated_at as number;
    const old = await db.all(
      `
          SELECT id, container_tag, is_pinned FROM memories
          WHERE updated_at < ? AND type IS NOT 'memorisation'
        `,
      [cutoff]
    );
    expect(plain(await rows.memoryRowsUpdatedBefore(shard, cutoff))).toEqual(plain(old));
    expect((await rows.memoryRowsUpdatedBefore(shard, cutoff)).map((r) => r.id)).toEqual([
      "m_a",
      "m_b",
    ]);
  });

  it("(r) the linked-search reads match the caller SQL and use the given opener", async () => {
    const shard = await freshShard();
    await seed(shard);
    const db = await engineDb(shard);
    const spy = spyOpener();
    const embedding = await db.all(
      `SELECT key, value FROM shard_metadata WHERE key IN ('embedding_dimensions', 'embedding_model')`
    );
    expect(embedding.length).toBeGreaterThan(0);
    expect(plain(await rows.shardEmbeddingRows(shard, spy.open))).toEqual(plain(embedding));
    expect(plain(await rows.shardEmbeddingRows(shard))).toEqual(plain(embedding));

    expect(await rows.hasMemoryRow(shard, "mem_1", spy.open)).toBe(true);
    expect(await rows.hasMemoryRow(shard, "missing")).toBe(false);

    for (const [id, tag] of [
      ["m_a", null],
      ["m_a", TAG],
      ["m_a", OTHER_TAG],
      ["missing", null],
    ] as const) {
      const expected = await db.get(
        `SELECT * FROM memories WHERE id = ? AND (? IS NULL OR container_tag = ?)`,
        [id, tag, tag]
      );
      const got = await rows.getMemoryRowInProject(shard, id, tag, spy.open);
      expect(got ? { ...got } : null).toEqual(expected ? { ...expected } : null);
    }
    expect(await rows.getMemoryRowInProject(shard, "m_a", OTHER_TAG)).toBeNull();
    expect(spy.opened.every((path) => path === shard.dbPath)).toBe(true);
    expect(spy.opened).toHaveLength(6);
  });
});
