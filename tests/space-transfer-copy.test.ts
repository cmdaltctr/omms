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
 * Target fake that stores rows, allocates shards per scope group like the real
 * store, rolls a shard over at the capacity the test sets, and derives both
 * duplicate sets from what it holds. `insertBatch` throws before storing
 * anything when `failOnShard` matches, which models a transaction that rolls
 * back. Shard counts move only through `setShardCount`.
 */
class FakeTarget implements TargetWriter {
  readonly stored: TransferWriteRow[] = [];
  readonly insertCalls: Array<{ shardKey: string; rows: TransferWriteRow[] }> = [];
  readonly setCountCalls: Array<{ shardKey: string; count: number }> = [];
  private readonly shardCounts = new Map<string, number>();
  private readonly shardsByScope = new Map<string, string[]>();
  failOnShard?: string;
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
  async insertBatch(shard: TargetShard, rows: TransferWriteRow[]): Promise<void> {
    this.insertCalls.push({ shardKey: shard.key, rows: [...rows] });
    if (this.failOnShard === shard.key) {
      throw new Error(`forced write failure on ${shard.key}`);
    }
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
  readonly mutatingCalls = new Set<string>();

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
    this.mutatingCalls.add("deleteFromShard");
    this.deleted.push({ shardKey, ids: [...ids] });
    this.rows = this.rows.filter((row) => !ids.includes(row.id));
  }
  async setShardCount(shardKey: string, count: number) {
    this.mutatingCalls.add("setShardCount");
    this.setCountCalls.push({ shardKey, count });
    this.counts.set(shardKey, count);
  }
}

function copy(
  source: FakeSource,
  target: FakeTarget,
  options: { maxVectorsPerShard?: number; embed?: (text: string) => Promise<Float32Array> } = {}
) {
  return applyTransfer({
    source,
    target,
    filter: FILTER,
    mode: "copy",
    maxVectorsPerShard: options.maxVectorsPerShard ?? 100,
    embed: options.embed,
  });
}

describe("applyTransfer copy: fields", () => {
  it("writes every stored field unchanged and reuses the stored vector", async () => {
    const row = makeRow({
      id: "full",
      text: "keep every field",
      tags: "alpha,beta",
      type: "decision",
      createdAt: Date.UTC(2026, 9, 5, 12, 30),
      updatedAt: Date.UTC(2026, 9, 6, 8, 0),
      metadata: JSON.stringify({ source: "test" }),
      isPinned: true,
      containerTag: PROJECT_TAG,
      vector: new Float32Array([0.25, 0.75]),
      tagsVector: new Float32Array([0.5, 0.5]),
    });
    const embedTexts: string[] = [];
    const target = new FakeTarget();
    const result = await copy(new FakeSource([row]), target, {
      embed: async (text) => {
        embedTexts.push(text);
        return new Float32Array([9, 9]);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(1);
    expect(result.embeddedAgain).toBe(false);
    expect(embedTexts).toEqual([]);

    expect(target.stored).toHaveLength(1);
    const written = target.stored[0]!;
    expect(written.id).toBe("full");
    expect(written.text).toBe("keep every field");
    expect(written.tags).toBe("alpha,beta");
    expect(written.type).toBe("decision");
    expect(written.createdAt).toBe(Date.UTC(2026, 9, 5, 12, 30));
    expect(written.updatedAt).toBe(Date.UTC(2026, 9, 6, 8, 0));
    expect(written.metadata).toBe(JSON.stringify({ source: "test" }));
    expect(written.isPinned).toBe(true);
    expect(written.containerTag).toBe(PROJECT_TAG);
    expect(Array.from(written.vector)).toEqual([0.25, 0.75]);
    expect(Array.from(written.tagsVector ?? [])).toEqual([0.5, 0.5]);
  });

  it("leaves the source untouched", async () => {
    const source = new FakeSource([makeRow({ id: "r1" }), makeRow({ id: "r2" })]);
    const result = await copy(source, new FakeTarget());
    expect(result.ok).toBe(true);
    expect(source.rows.map((row) => row.id)).toEqual(["r1", "r2"]);
    expect(source.deleted).toEqual([]);
    expect(source.setCountCalls).toEqual([]);
    expect(source.mutatingCalls.size).toBe(0);
  });
});

describe("applyTransfer copy: batching", () => {
  it("splits writes to the shard capacity and sets each shard count", async () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => makeRow({ id }));
    const target = new FakeTarget(2);
    const result = await copy(new FakeSource(rows), target, { maxVectorsPerShard: 2 });

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(5);
    expect(
      target.insertCalls.map((call) => ({ key: call.shardKey, size: call.rows.length }))
    ).toEqual([
      { key: "tgt-project-0", size: 2 },
      { key: "tgt-project-1", size: 2 },
      { key: "tgt-project-2", size: 1 },
    ]);
    expect(target.setCountCalls).toEqual([
      { shardKey: "tgt-project-0", count: 2 },
      { shardKey: "tgt-project-1", count: 2 },
      { shardKey: "tgt-project-2", count: 1 },
    ]);
  });

  it("writes each scope group into its own shard stream", async () => {
    const rows = [
      makeRow({ id: "p1", containerTag: PROJECT_TAG }),
      makeRow({ id: "u1", containerTag: USER_TAG }),
    ];
    const target = new FakeTarget(10);
    const result = await copy(new FakeSource(rows), target, { maxVectorsPerShard: 10 });

    expect(result.ok).toBe(true);
    expect(
      target.insertCalls.map((call) => ({
        key: call.shardKey,
        ids: call.rows.map((row) => row.id),
      }))
    ).toEqual([
      { key: "tgt-project-0", ids: ["p1"] },
      { key: "tgt-user-0", ids: ["u1"] },
    ]);
  });
});

describe("applyTransfer copy: write failures", () => {
  it("leaves no partial batch in the failed transaction", async () => {
    const rows = ["a", "b", "c"].map((id) => makeRow({ id }));
    const target = new FakeTarget(2);
    target.failOnShard = "tgt-project-1";
    const result = await copy(new FakeSource(rows), target, { maxVectorsPerShard: 2 });

    expect(result.ok).toBe(false);
    expect(result.error?.step).toBe("write");
    expect(result.copied).toBe(2);
    expect(target.stored.map((row) => row.id)).toEqual(["a", "b"]);
    expect(target.insertCalls).toHaveLength(2);
  });

  it("skips what arrived when the same transfer runs again", async () => {
    const rows = ["a", "b", "c"].map((id) => makeRow({ id, text: `text of ${id}` }));
    const source = new FakeSource(rows);
    const target = new FakeTarget(2);
    target.failOnShard = "tgt-project-1";
    await copy(source, target, { maxVectorsPerShard: 2 });

    target.failOnShard = undefined;
    const result = await copy(source, target, { maxVectorsPerShard: 2 });

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(2);
    expect(target.stored.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});

describe("applyTransfer copy: the source changed after the preview", () => {
  it("copies what matches at apply time and reports the changed count", async () => {
    const source = new FakeSource([makeRow({ id: "r1" }), makeRow({ id: "r2" })]);
    const target = new FakeTarget();
    const preview = await previewTransfer({ source, target, filter: FILTER });
    expect(preview.matched).toBe(2);

    source.rows.push(makeRow({ id: "r3" }));
    const result = await copy(source, target, {});

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(3);
  });

  it("reports a negative changed count when rows left the source", async () => {
    const source = new FakeSource([makeRow({ id: "r1" }), makeRow({ id: "r2" })]);
    const target = new FakeTarget();
    const preview = await previewTransfer({ source, target, filter: FILTER });
    expect(preview.matched).toBe(2);

    source.rows.pop();
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 100,
      previewMatched: preview.matched,
    });

    expect(result.ok).toBe(true);
    expect(result.copied).toBe(1);
    expect(result.changedFromPreview).toBe(-1);
  });

  it("reports the changed count against the preview's matched rows", async () => {
    const source = new FakeSource([makeRow({ id: "r1" }), makeRow({ id: "r2" })]);
    const target = new FakeTarget();
    const preview = await previewTransfer({ source, target, filter: FILTER });

    source.rows.push(makeRow({ id: "r3" }));
    const result = await applyTransfer({
      source,
      target,
      filter: FILTER,
      mode: "copy",
      maxVectorsPerShard: 100,
      previewMatched: preview.matched,
    });

    expect(result.changedFromPreview).toBe(1);
    expect(result.copied).toBe(3);
  });
});

describe("applyTransfer copy: embedding", () => {
  it("embeds again when the source model differs", async () => {
    const row = makeRow({ id: "r1", tags: "alpha", vector: new Float32Array([0.25, 0.75]) });
    const source = new FakeSource([row], { model: "old-model", dimensions: 8 });
    const target = new FakeTarget();
    const embedTexts: string[] = [];
    const result = await copy(source, target, {
      embed: async (text) => {
        embedTexts.push(text);
        return new Float32Array([9, 9]);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.embeddedAgain).toBe(true);
    expect(embedTexts).toEqual(["text of the row", "Topics: alpha"]);
    expect(Array.from(target.stored[0]!.vector)).toEqual([9, 9]);
    expect(Array.from(target.stored[0]!.tagsVector ?? [])).toEqual([9, 9]);
  });

  it("embeds again when the source dimensions differ", async () => {
    const row = makeRow({ id: "r1" });
    const source = new FakeSource([row], { model: "model-a", dimensions: 4 });
    const target = new FakeTarget();
    const result = await copy(source, target, {
      embed: async () => new Float32Array([9, 9]),
    });

    expect(result.ok).toBe(true);
    expect(result.embeddedAgain).toBe(true);
    expect(Array.from(target.stored[0]!.vector)).toEqual([9, 9]);
  });

  it("fails with a reported error when re-embedding is needed but no callback was given", async () => {
    const row = makeRow({ id: "r1" });
    const source = new FakeSource([row], { model: "old-model", dimensions: 8 });
    const target = new FakeTarget();
    const result = await copy(source, target);

    expect(result.ok).toBe(false);
    expect(result.error?.step).toBe("write");
    expect(result.error?.message).toContain("no embed callback");
    expect(result.copied).toBe(0);
    expect(target.stored).toEqual([]);
  });
});
