import { describe, expect, it } from "bun:test";
import {
  applyTransfer,
  previewTransfer,
  tagTextKey,
  type EmbeddingInfo,
  type SourceReader,
  type TargetShard,
  type TargetWriter,
  type TransferRow,
  type TransferWriteRow,
} from "../src/services/spaces/transfer.js";

const PROJECT_TAG = "omms_project_0123456789abcdef";
const OTHER_PROJECT_TAG = "omms_project_fedcba9876543210";

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
    updatedAt: Date.UTC(2026, 9, 15),
    isPinned: false,
    shardKey: "src-0",
    vector: new Float32Array([0.25, 0.75]),
    ...overrides,
  };
}

/** Target fake that stores rows and derives both duplicate sets from what it holds. */
class FakeTarget implements TargetWriter {
  readonly stored: TransferWriteRow[] = [];
  readonly insertCalls: Array<{ shardKey: string; rows: TransferWriteRow[] }> = [];
  readonly setCountCalls: Array<{ shardKey: string; count: number }> = [];
  private readonly shards: Array<{ key: string; count: number }> = [{ key: "shard-0", count: 0 }];
  failOnShard?: string;

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
  async getWriteShard(): Promise<TargetShard> {
    const shard = this.shards.find((entry) => entry.count < this.capacity);
    if (!shard) throw new Error("fake target ran out of shards");
    return { key: shard.key, vectorCount: shard.count };
  }
  async insertBatch(shard: TargetShard, rows: TransferWriteRow[]): Promise<void> {
    this.insertCalls.push({ shardKey: shard.key, rows: [...rows] });
    if (this.failOnShard === shard.key) {
      throw new Error(`forced write failure on ${shard.key}`);
    }
    this.stored.push(...rows);
  }
  async setShardCount(shardKey: string, count: number) {
    this.setCountCalls.push({ shardKey, count });
    const shard = this.shards.find((entry) => entry.key === shardKey);
    if (shard) {
      shard.count = count;
    } else {
      this.shards.push({ key: shardKey, count });
    }
  }
  async findExistingIds(ids: string[]) {
    const held = new Set(this.stored.map((row) => row.id));
    return new Set(ids.filter((id) => held.has(id)));
  }
}

class FakeSource implements SourceReader {
  constructor(
    readonly rows: TransferRow[],
    readonly embedding: EmbeddingInfo | undefined = MATCHING_EMBEDDING
  ) {}
  async readRows() {
    return [...this.rows];
  }
  async getEmbeddingInfo() {
    return this.embedding;
  }
  async getShardCounts(keys: string[]) {
    return new Map(keys.map((key) => [key, 0] as const));
  }
  async deleteFromShard() {
    throw new Error("copy must not delete from the source");
  }
  async setShardCount() {
    throw new Error("copy must not set a source shard count");
  }
}

function seedRow(
  target: FakeTarget,
  row: { id: string; text: string; containerTag?: string }
): void {
  target.stored.push({
    id: row.id,
    text: row.text,
    containerTag: row.containerTag ?? PROJECT_TAG,
    createdAt: 1,
    updatedAt: 1,
    isPinned: false,
    vector: new Float32Array([0.5]),
  });
}

/** The four duplicate-rule cases in one fixture: same id, same tag and text, similar, other tag. */
function duplicateFixture(): { source: FakeSource; target: FakeTarget } {
  const target = new FakeTarget();
  seedRow(target, { id: "taken-id", text: "target text under a taken id" });
  seedRow(target, { id: "other-id", text: "same tag text" });
  seedRow(target, { id: "similar-id", text: "similar text!" });
  seedRow(target, { id: "other-tag-id", text: "cross tag text", containerTag: OTHER_PROJECT_TAG });

  const source = new FakeSource([
    makeRow({ id: "taken-id", text: "source text under a taken id" }),
    makeRow({ id: "new-1", text: "same tag text" }),
    makeRow({ id: "new-2", text: "similar text" }),
    makeRow({ id: "new-3", text: "cross tag text" }),
  ]);
  return { source, target };
}

describe("the exact-duplicate rule", () => {
  it("skips a source row whose id the target already holds", async () => {
    const target = new FakeTarget();
    seedRow(target, { id: "taken-id", text: "target text" });
    const source = new FakeSource([makeRow({ id: "taken-id", text: "source text" })]);
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.copied).toBe(0);
    expect(target.stored.map((row) => row.id)).toEqual(["taken-id"]);
  });

  it("skips a source row with the same tag and text under another id", async () => {
    const target = new FakeTarget();
    seedRow(target, { id: "other-id", text: "shared text" });
    const source = new FakeSource([makeRow({ id: "new-1", text: "shared text" })]);
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.copied).toBe(0);
    expect(target.stored.map((row) => row.id)).toEqual(["other-id"]);
  });

  it("keeps a source row whose text is only similar", async () => {
    const target = new FakeTarget();
    seedRow(target, { id: "similar-id", text: "similar text!" });
    const source = new FakeSource([makeRow({ id: "new-2", text: "similar text" })]);
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(0);
    expect(result.copied).toBe(1);
    expect(target.stored.map((row) => row.id).sort()).toEqual(["new-2", "similar-id"]);
  });

  it("keeps a source row whose text the target holds under another tag", async () => {
    const target = new FakeTarget();
    seedRow(target, { id: "other-tag-id", text: "shared text", containerTag: OTHER_PROJECT_TAG });
    const source = new FakeSource([makeRow({ id: "new-3", text: "shared text" })]);
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(0);
    expect(result.copied).toBe(1);
    expect(target.stored.map((row) => row.id).sort()).toEqual(["new-3", "other-tag-id"]);
  });

  it("applies all four cases in one transfer", async () => {
    const { source, target } = duplicateFixture();
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(2);
    expect(target.stored.map((row) => row.id).sort()).toEqual([
      "new-2",
      "new-3",
      "other-id",
      "other-tag-id",
      "similar-id",
      "taken-id",
    ]);
  });

  it("shows the same split in a preview", async () => {
    const { source, target } = duplicateFixture();
    const result = await previewTransfer({ source, target, filter: FILTER });
    expect(result.matched).toBe(4);
    expect(result.duplicates).toBe(2);
    expect(result.toCopy).toBe(2);
  });
});
