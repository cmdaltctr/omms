import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const SCOPE_HASH = "b2c3d4e5f6a78901";
const CONTAINER = `opencode_project_${SCOPE_HASH}`;
const THRESHOLD = 0.5;

describe("keywordMode rrf across shards", () => {
  let baseDir: string;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  async function setup() {
    baseDir = mkdtempSync(join(tmpdir(), "keyword-rrf-test-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const shard = await tursoShardManager.createShard("project", SCOPE_HASH, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const dims = CONFIG.embeddingDimensions;
    const unit = (axis: number) => {
      const vector = new Float32Array(dims);
      vector[axis] = 1;
      return vector;
    };
    let count = 0;
    // `near` memories point the same way as the query; the others point away from it.
    const add = (id: string, content: string, near: boolean) => {
      const vector = unit(near ? 0 : 2);
      vector[10 + count++] = 0.2;
      return tursoVectorSearch.insertVector(db, {
        id,
        content,
        vector,
        tagsVector: unit(1),
        containerTag: CONTAINER,
        tags: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    };
    const search = async (text: string, keywordBoost: number, mode: "boost" | "rrf") =>
      (
        await tursoVectorSearch.searchAcrossShards(
          [shard],
          unit(0),
          CONTAINER,
          10,
          THRESHOLD,
          text,
          keywordBoost,
          mode
        )
      ).results;
    const hasIndex = async () =>
      (await db.all(`SELECT name FROM sqlite_schema WHERE name = 'memories_fts'`)).length === 1;
    return { add, search, hasIndex };
  }

  it("returns a word match that is below the threshold, which boost mode does not", async () => {
    const { add, search } = await setup();
    await add("m_near", "Notes about lunch", true);
    await add("m_word", "We chose Postgres for billing", false);

    const boost = await search("postgres", 0.1, "boost");
    expect(boost.map((r) => r.id)).toEqual(["m_near"]);

    const rrf = await search("postgres", 0.1, "rrf");
    expect(rrf.map((r) => r.id).sort()).toEqual(["m_near", "m_word"]);
  });

  it("keeps each result's own similarity and hides the word score", async () => {
    const { add, search } = await setup();
    await add("m_near", "Notes about lunch", true);
    await add("m_word", "We chose Postgres for billing", false);

    const plain = new Map((await search("postgres", 0, "boost")).map((r) => [r.id, r.similarity]));
    const rrf = await search("postgres", 0.1, "rrf");
    const word = rrf.find((r) => r.id === "m_word");
    expect(word?.similarity).toBeLessThan(THRESHOLD);
    expect(rrf.find((r) => r.id === "m_near")?.similarity).toBe(plain.get("m_near"));
    for (const result of rrf) expect("keywordScore" in result).toBe(false);
  });

  it("does not add the boost to the similarity of a memory with a word match", async () => {
    const { add, search } = await setup();
    await add("m_both", "We chose Postgres for billing", true);
    const plain = (await search("postgres", 0, "boost")).find((r) => r.id === "m_both");
    const rrf = (await search("postgres", 0.1, "rrf")).find((r) => r.id === "m_both");
    expect(rrf?.similarity).toBe(plain?.similarity);
  });

  it("keeps a strong word match that the per-shard limit would cut", async () => {
    const { add, search } = await setup();
    for (let index = 0; index < 12; index++) await add(`m_${index}`, `Lunch note ${index}`, true);
    await add("m_word", "We chose Postgres for billing", false);
    const rrf = await search("postgres", 0.1, "rrf");
    expect(rrf.map((r) => r.id)).toContain("m_word");
    expect(rrf).toHaveLength(10);
  });

  it("ranks a memory found by meaning and by words above one found by meaning only", async () => {
    const { add, search } = await setup();
    await add("m_other", "Notes about lunch", true);
    await add("m_both", "We chose Postgres for billing", true);
    const rrf = await search("postgres", 0.1, "rrf");
    expect(rrf[0].id).toBe("m_both");
  });

  it("returns the meaning list unchanged when no memory holds a query word", async () => {
    const { add, search } = await setup();
    await add("m_a", "Notes about lunch", true);
    await add("m_b", "Notes about dinner", true);
    const plain = (await search("zebra", 0, "boost")).map((r) => r.id);
    const rrf = (await search("zebra", 0.1, "rrf")).map((r) => r.id);
    expect(rrf).toEqual(plain);
  });

  it("matches the old results and builds no index when keywordBoost is 0", async () => {
    const { add, search, hasIndex } = await setup();
    await add("m_near", "Notes about lunch", true);
    await add("m_word", "We chose Postgres for billing", false);
    const old = await search("postgres", 0, "boost");
    const rrf = await search("postgres", 0, "rrf");
    expect(rrf).toEqual(old);
    expect(await hasIndex()).toBe(false);
  });

  it("returns at most limit results", async () => {
    const { add, search } = await setup();
    for (let index = 0; index < 14; index++)
      await add(`m_${index}`, `Postgres note ${index}`, true);
    expect(await search("postgres", 0.1, "rrf")).toHaveLength(10);
  });
});
