import { describe, expect, it } from "bun:test";
import {
  applyTransfer,
  tagTextKey,
  type EmbeddingInfo,
  type SourceReader,
  type TargetShard,
  type TargetWriter,
  type TransferRow,
  type TransferWriteRow,
} from "../src/services/spaces/transfer.js";

const PROJECT_TAG = "omms_project_0123456789abcdef";
const USER_TAG = "omms_user_0123456789abcdef";

const FILTER = {
  since: Date.UTC(2026, 9, 1),
  until: Date.UTC(2026, 9, 31),
};
const MATCHING_EMBEDDING: EmbeddingInfo = { model: "model-a", dimensions: 8 };

function makeRow(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "row",
    text: "text of the row",
    containerTag: PROJECT_TAG,
    createdAt: Date.UTC(2026, 9, 15),
    updatedAt: Date.UTC(2026, 9, 16),
    isPinned: false,
    shardKey: "src-0",
    vector: new Float32Array([0.25, 0.75]),
    ...overrides,
  };
}

/**
 * Target fake that allocates shards per scope group, like the real store, and
 * rolls over at the capacity the test sets. Shard counts move only through
 * `setShardCount`, so the engine must keep them right.
 */
class FakeTarget implements TargetWriter {
  readonly stored: TransferWriteRow[] = [];
  readonly setCountCalls: Array<{ shardKey: string; count: number }> = [];
  private readonly shardCounts = new Map<string, number>();
  private readonly shardsByScope = new Map<string, string[]>();
  /** Ids the check pretends are missing, even though the copy wrote them. */
  dropIdsAtCheck = new Set<string>();

  constructor(private readonly capacity = 100) {}

  async loadExistingIds() {
    return new Set(this.stored.map((row) => row.id));
  }
  async loadExistingTagTexts() {
    return new Set(this.stored.map((row) => tagTextKey(row.containerTag, row.text)));
  }
  async getEmbeddingSettings() {
    return MATCHING_EMBEDDING;
  }
  async getWriteShard(scope: "user" | "project", _scopeHash: string): Promise<TargetShard> {
    const keys = this.shardsByScope.get(`${scope}:${_scopeHash}`) ?? [];
    for (const key of keys) {
      const count = this.shardCounts.get(key) ?? 0;
      if (count < this.capacity) return { key, vectorCount: count };
    }
    const key = `tgt-${scope}-${keys.length}`;
    keys.push(key);
    this.shardsByScope.set(`${scope}:${_scopeHash}`, keys);
    this.shardCounts.set(key, 0);
    return { key, vectorCount: 0 };
  }
  async insertBatch(_shard: TargetShard, rows: TransferWriteRow[]): Promise<void> {
    this.stored.push(...rows);
  }
  async setShardCount(shardKey: string, count: number) {
    this.setCountCalls.push({ shardKey, count });
    this.shardCounts.set(shardKey, count);
  }
  async findExistingIds(ids: string[]) {
    const held = new Set(this.stored.map((row) => row.id));
    return new Set(ids.filter((id) => held.has(id) && !this.dropIdsAtCheck.has(id)));
  }
}

class FakeSource implements SourceReader {
  readonly rows: TransferRow[];
  readonly deleted: Array<{ shardKey: string; ids: string[] }> = [];
  readonly setCountCalls: Array<{ shardKey: string; count: number }> = [];
  readonly counts = new Map<string, number>();

  constructor(
    rows: TransferRow[],
    readonly embedding: EmbeddingInfo | undefined = MATCHING_EMBEDDING
  ) {
    this.rows = [...rows];
  }

  async readRows() {
    return [...this.rows];
  }
  async getEmbeddingInfo() {
    return this.embedding;
  }
  async getShardCounts(keys: string[]) {
    return new Map(keys.map((key) => [key, this.counts.get(key) ?? 0] as const));
  }
  async deleteFromShard(shardKey: string, ids: string[]) {
    this.deleted.push({ shardKey, ids: [...ids] });
    this.rows = this.rows.filter((row) => !ids.includes(row.id));
  }
  async setShardCount(shardKey: string, count: number) {
    this.setCountCalls.push({ shardKey, count });
    this.counts.set(shardKey, count);
  }
}

function move(source: FakeSource, target: FakeTarget, maxVectorsPerShard = 100) {
  return applyTransfer({
    source,
    target,
    filter: FILTER,
    mode: "move",
    maxVectorsPerShard,
  });
}

describe("applyTransfer move", () => {
  it("removes every copied id from the source and fixes both stores' counts", async () => {
    const rows = ["a", "b", "c"].map((id) => makeRow({ id }));
    const source = new FakeSource(rows);
    source.counts.set("src-0", 5);
    const target = new FakeTarget();

    const result = await move(source, target);

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(3);
    expect(result.removed).toBe(3);
    expect(result.skipped).toBe(0);

    expect(source.deleted).toEqual([{ shardKey: "src-0", ids: ["a", "b", "c"] }]);
    expect(source.rows).toEqual([]);
    expect(source.setCountCalls).toEqual([{ shardKey: "src-0", count: 2 }]);

    expect(target.stored.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(target.setCountCalls).toEqual([{ shardKey: "tgt-project-0", count: 3 }]);
  });

  it("keeps exact duplicates in the source", async () => {
    const rows = ["a", "b", "c"].map((id) => makeRow({ id, text: `text of ${id}` }));
    const source = new FakeSource(rows);
    const target = new FakeTarget();
    // The target already holds "a" under the same id.
    target.stored.push({
      id: "a",
      text: rows[0]!.text,
      containerTag: PROJECT_TAG,
      createdAt: 1,
      updatedAt: 1,
      isPinned: false,
      vector: new Float32Array([0.5]),
    });

    const result = await move(source, target);

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.removed).toBe(2);
    expect(source.deleted).toEqual([{ shardKey: "src-0", ids: ["b", "c"] }]);
    expect(source.rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("removes nothing when the check finds a missing id", async () => {
    const rows = ["a", "b", "c"].map((id) => makeRow({ id }));
    const source = new FakeSource(rows);
    source.counts.set("src-0", 3);
    const target = new FakeTarget();
    target.dropIdsAtCheck = new Set(["b"]);

    const result = await move(source, target);

    expect(result.ok).toBe(false);
    expect(result.error?.step).toBe("check");
    expect(result.missingIds).toEqual(["b"]);
    expect(result.removed).toBe(0);
    expect(source.deleted).toEqual([]);
    expect(source.setCountCalls).toEqual([]);
    expect(source.rows).toHaveLength(3);
    // The copy itself happened; only the removal was refused.
    expect(target.stored.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("removes nothing when every row was an exact duplicate", async () => {
    const rows = [makeRow({ id: "a" })];
    const source = new FakeSource(rows);
    const target = new FakeTarget();
    target.stored.push({
      id: "a",
      text: rows[0]!.text,
      containerTag: PROJECT_TAG,
      createdAt: 1,
      updatedAt: 1,
      isPinned: false,
      vector: new Float32Array([0.5]),
    });

    const result = await move(source, target);

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.removed).toBe(0);
    expect(source.deleted).toEqual([]);
    expect(source.rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("fixes the vector counts of both stores across several shards", async () => {
    const rows = [
      makeRow({ id: "a", shardKey: "src-0" }),
      makeRow({ id: "b", shardKey: "src-0" }),
      makeRow({ id: "c", shardKey: "src-1" }),
      makeRow({ id: "u", shardKey: "src-2", containerTag: USER_TAG }),
    ];
    const source = new FakeSource(rows);
    source.counts.set("src-0", 4);
    source.counts.set("src-1", 2);
    source.counts.set("src-2", 7);
    const target = new FakeTarget(2);

    const result = await move(source, target, 2);

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(4);
    expect(result.removed).toBe(4);

    // Target: the project group needs two shards, the user group its own.
    expect(target.setCountCalls).toEqual([
      { shardKey: "tgt-project-0", count: 2 },
      { shardKey: "tgt-project-1", count: 1 },
      { shardKey: "tgt-user-0", count: 1 },
    ]);

    // Source: one delete transaction per shard, counts fixed to the leftovers.
    expect(source.deleted).toEqual([
      { shardKey: "src-0", ids: ["a", "b"] },
      { shardKey: "src-1", ids: ["c"] },
      { shardKey: "src-2", ids: ["u"] },
    ]);
    expect(source.setCountCalls).toEqual([
      { shardKey: "src-0", count: 2 },
      { shardKey: "src-1", count: 1 },
      { shardKey: "src-2", count: 6 },
    ]);
  });
});
