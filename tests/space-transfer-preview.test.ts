import { describe, expect, it } from "bun:test";
import {
  previewTransfer,
  tagTextKey,
  type SourceReader,
  type TargetShard,
  type TargetWriter,
  type TransferFilter,
  type TransferRow,
} from "../src/services/spaces/transfer.js";

const PROJECT_TAG = "omms_project_0123456789abcdef";
const OTHER_PROJECT_TAG = "omms_project_fedcba9876543210";
const USER_TAG = "omms_user_0123456789abcdef";

const SINCE = Date.UTC(2026, 9, 1);
const UNTIL = Date.UTC(2026, 9, 31);

function makeRow(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "row",
    text: "text of the row",
    containerTag: PROJECT_TAG,
    createdAt: Date.UTC(2026, 9, 15),
    updatedAt: Date.UTC(2026, 9, 15),
    isPinned: false,
    shardKey: "src-0",
    ...overrides,
  };
}

/** Read-only source fake. It returns every row unfiltered, so the engine's own filter runs. */
class FakeSource implements SourceReader {
  readonly calls = new Set<string>();
  constructor(private readonly rows: TransferRow[]) {}

  async readRows(): Promise<TransferRow[]> {
    this.calls.add("readRows");
    return [...this.rows];
  }
  async getEmbeddingInfo() {
    this.calls.add("getEmbeddingInfo");
    return undefined;
  }
  async getShardCounts(keys: string[]) {
    this.calls.add("getShardCounts");
    return new Map(keys.map((key) => [key, 0] as const));
  }
  async deleteFromShard() {
    this.calls.add("deleteFromShard");
  }
  async setShardCount() {
    this.calls.add("setShardCount");
  }
}

/** Target fake whose write methods throw, so a preview that writes fails loudly. */
class FakeTarget implements TargetWriter {
  readonly calls = new Set<string>();
  existingIds = new Set<string>();
  existingTagTexts = new Set<string>();

  async loadExistingIds() {
    this.calls.add("loadExistingIds");
    return new Set(this.existingIds);
  }
  async loadExistingTagTexts() {
    this.calls.add("loadExistingTagTexts");
    return new Set(this.existingTagTexts);
  }
  async getEmbeddingSettings() {
    this.calls.add("getEmbeddingSettings");
    return { model: "model-a", dimensions: 8 };
  }
  async getWriteShard(): Promise<TargetShard> {
    this.calls.add("getWriteShard");
    throw new Error("a preview must not ask for a write shard");
  }
  async insertBatch(): Promise<void> {
    this.calls.add("insertBatch");
    throw new Error("a preview must not write");
  }
  async setShardCount() {
    this.calls.add("setShardCount");
    throw new Error("a preview must not set a shard count");
  }
  async findExistingIds(ids: string[]) {
    this.calls.add("findExistingIds");
    return new Set(ids);
  }
}

function preview(
  rows: TransferRow[],
  options: { target?: FakeTarget; filter?: TransferFilter } = {}
) {
  return previewTransfer({
    source: new FakeSource(rows),
    target: options.target ?? new FakeTarget(),
    filter: options.filter ?? { since: SINCE, until: UNTIL },
  });
}

describe("previewTransfer: date range", () => {
  it("includes a row created exactly at the lower bound", async () => {
    const rows = [
      makeRow({ id: "at-since", createdAt: SINCE }),
      makeRow({ id: "before", createdAt: SINCE - 1 }),
    ];
    const result = await preview(rows);
    expect(result.matched).toBe(1);
    expect(result.examples.map((example) => example.id)).toEqual(["at-since"]);
  });

  it("includes a row created exactly at the upper bound", async () => {
    const rows = [
      makeRow({ id: "at-until", createdAt: UNTIL }),
      makeRow({ id: "after", createdAt: UNTIL + 1 }),
    ];
    const result = await preview(rows);
    expect(result.matched).toBe(1);
    expect(result.examples.map((example) => example.id)).toEqual(["at-until"]);
  });

  it("keeps rows inside the range and drops rows on either side", async () => {
    const rows = [
      makeRow({ id: "before", createdAt: SINCE - 1 }),
      makeRow({ id: "first", createdAt: SINCE }),
      makeRow({ id: "last", createdAt: UNTIL }),
      makeRow({ id: "after", createdAt: UNTIL + 1 }),
    ];
    const result = await preview(rows);
    expect(result.matched).toBe(2);
    expect(result.examples.map((example) => example.id).sort()).toEqual(["first", "last"]);
  });
});

describe("previewTransfer: project filter and groups", () => {
  it("keeps only rows of the named project tag when a filter is given", async () => {
    const rows = [
      makeRow({ id: "p1", containerTag: PROJECT_TAG, projectName: "Experiments" }),
      makeRow({ id: "p2", containerTag: OTHER_PROJECT_TAG, projectName: "Client work" }),
      makeRow({ id: "u1", containerTag: USER_TAG }),
    ];
    const result = await preview(rows, {
      filter: { since: SINCE, until: UNTIL, projectTag: PROJECT_TAG },
    });
    expect(result.matched).toBe(1);
    expect(result.groups).toEqual([{ name: "Experiments", tag: PROJECT_TAG, count: 1 }]);
  });

  it("groups rows of every project when no project filter is given", async () => {
    const rows = [
      makeRow({ id: "p1", containerTag: PROJECT_TAG, projectName: "Experiments" }),
      makeRow({ id: "p2", containerTag: OTHER_PROJECT_TAG, projectName: "Client work" }),
      makeRow({ id: "u1", containerTag: USER_TAG }),
    ];
    const result = await preview(rows);
    expect(result.matched).toBe(3);
    expect(result.groups).toEqual([
      { name: "Experiments", tag: PROJECT_TAG, count: 1 },
      { name: "Client work", tag: OTHER_PROJECT_TAG, count: 1 },
      { name: "Personal", tag: USER_TAG, count: 1 },
    ]);
  });

  it("groups user-scope rows together under Personal", async () => {
    const rows = [
      makeRow({ id: "u1", containerTag: USER_TAG }),
      makeRow({ id: "u2", containerTag: USER_TAG }),
      makeRow({ id: "p1", containerTag: PROJECT_TAG, projectName: "Experiments" }),
    ];
    const result = await preview(rows);
    expect(result.groups).toEqual([
      { name: "Personal", tag: USER_TAG, count: 2 },
      { name: "Experiments", tag: PROJECT_TAG, count: 1 },
    ]);
  });

  it("names a group by its tag when the rows carry no project name", async () => {
    const rows = [makeRow({ id: "p1", containerTag: PROJECT_TAG })];
    const result = await preview(rows);
    expect(result.groups).toEqual([{ name: PROJECT_TAG, tag: PROJECT_TAG, count: 1 }]);
  });

  it("reports zero and offers nothing for a filter that matches no row", async () => {
    const rows = [makeRow({ id: "p1", createdAt: Date.UTC(2025, 0, 1) })];
    const result = await preview(rows);
    expect(result).toEqual({
      matched: 0,
      toCopy: 0,
      duplicates: 0,
      groups: [],
      examples: [],
    });
  });
});

describe("previewTransfer: examples", () => {
  it("returns at most five examples", async () => {
    const rows = Array.from({ length: 7 }, (_unused, index) => makeRow({ id: `r${index}` }));
    const result = await preview(rows);
    expect(result.examples).toHaveLength(5);
    expect(result.examples.map((example) => example.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  });

  it("cuts the example text at 160 characters", async () => {
    const rows = [
      makeRow({ id: "long", text: "x".repeat(200) }),
      makeRow({ id: "short", text: "short text" }),
    ];
    const result = await preview(rows);
    expect(result.examples[0]!.text).toBe("x".repeat(160));
    expect(result.examples[1]!.text).toBe("short text");
  });
});

describe("previewTransfer: duplicates and side effects", () => {
  it("counts the exact duplicates the target already holds", async () => {
    const target = new FakeTarget();
    target.existingIds = new Set(["dup-by-id"]);
    target.existingTagTexts = new Set([tagTextKey(PROJECT_TAG, "dup text")]);
    const rows = [
      makeRow({ id: "dup-by-id", text: "a different text" }),
      makeRow({ id: "fresh-1", text: "dup text" }),
      makeRow({ id: "fresh-2", text: "unique text" }),
    ];
    const result = await preview(rows, { target });
    expect(result.matched).toBe(3);
    expect(result.duplicates).toBe(2);
    expect(result.toCopy).toBe(1);
    expect(result.examples.map((example) => example.id)).toEqual(["fresh-2"]);
  });

  it("changes neither store", async () => {
    const source = new FakeSource([makeRow({ id: "r1" })]);
    const target = new FakeTarget();
    await previewTransfer({
      source,
      target,
      filter: { since: SINCE, until: UNTIL },
    });

    expect([...source.calls]).toEqual(["readRows"]);
    expect(target.calls.has("loadExistingIds")).toBe(true);
    expect(target.calls.has("loadExistingTagTexts")).toBe(true);
    expect(target.calls.has("getWriteShard")).toBe(false);
    expect(target.calls.has("insertBatch")).toBe(false);
    expect(target.calls.has("setShardCount")).toBe(false);
    expect(target.calls.has("findExistingIds")).toBe(false);
    expect(source.calls.has("deleteFromShard")).toBe(false);
    expect(source.calls.has("setShardCount")).toBe(false);
    expect(source.calls.has("getShardCounts")).toBe(false);
  });
});
