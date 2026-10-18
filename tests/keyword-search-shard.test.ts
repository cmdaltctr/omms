import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const BOOST = 0.3;
const SCOPE_HASH = "a1b2c3d4e5f67890";
const CONTAINER = `opencode_project_${SCOPE_HASH}`;

describe("keyword index in a shard", () => {
  let baseDir: string;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  async function setup() {
    baseDir = mkdtempSync(join(tmpdir(), "keyword-shard-test-"));
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
    const add = (id: string, content: string, tags = "") => {
      // Identical vectors make the approximate index return only some rows.
      const vector = unit(0);
      vector[10 + count++] = 0.2;
      return tursoVectorSearch.insertVector(db, {
        id,
        content,
        vector,
        tagsVector: unit(1),
        containerTag: CONTAINER,
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    };
    // The query vector is close to every memory's vector, so the approximate index
    // returns all of them and any difference between memories comes from the
    // keyword boost alone.
    const search = async (text: string, keywordBoost = BOOST) =>
      new Map(
        (
          await tursoVectorSearch.searchInShard(shard, unit(0), CONTAINER, 10, text, keywordBoost)
        ).map((result) => [result.id, result.similarity] as const)
      );
    const hasIndex = async () =>
      (await db.all(`SELECT name FROM sqlite_schema WHERE name = 'memories_fts'`)).length === 1;
    return { db, add, search, hasIndex, tursoVectorSearch };
  }

  it("finds a memory by a word in its text and in its tags", async () => {
    const { add, search } = await setup();
    await add("m_text", "We chose Postgres for billing");
    await add("m_tag", "Notes on caching", "redis,infra");
    await add("m_other", "Unrelated note about lunch");

    const byText = await search("postgres");
    const base = byText.get("m_other") as number;
    expect(byText.get("m_text")).toBeGreaterThan(base);
    expect(byText.get("m_text")).toBeLessThanOrEqual(base + BOOST + 1e-9);

    const byTag = await search("redis");
    expect(byTag.get("m_tag")).toBeGreaterThan(byTag.get("m_other") as number);
  });

  it("matches an identifier split across a hyphen", async () => {
    const { add, search } = await setup();
    await add("m_adr", "ADR-023 sets the release flow");
    await add("m_other", "Unrelated note about lunch");
    const results = await search("why did we write adr 023");
    expect(results.get("m_adr")).toBeGreaterThan(results.get("m_other") as number);
  });

  it("leaves scores alone when keywordBoost is 0 and does not build the index", async () => {
    const { add, search, hasIndex } = await setup();
    await add("m_text", "We chose Postgres for billing");
    await add("m_other", "Unrelated note about lunch");
    const results = await search("postgres", 0);
    expect(results.get("m_text")).toBe(results.get("m_other"));
    expect(await hasIndex()).toBe(false);
  });

  it("drops the match after an edit removes the word and after a delete", async () => {
    const { db, add, search, tursoVectorSearch } = await setup();
    await add("m_edit", "We chose Postgres for billing");
    await add("m_gone", "Postgres tuning notes");
    await add("m_other", "Unrelated note about lunch");
    const before = await search("postgres");
    expect(before.get("m_edit")).toBeGreaterThan(before.get("m_other") as number);

    await db.run(`UPDATE memories SET content = ? WHERE id = ?`, ["We chose MySQL", "m_edit"]);
    await tursoVectorSearch.deleteVector(db, "m_gone");

    const after = await search("postgres");
    expect(after.get("m_edit")).toBe(after.get("m_other"));
    expect(after.has("m_gone")).toBe(false);
  });

  it("builds the index on first search in an older shard and keeps every memory", async () => {
    const { db, add, search, hasIndex } = await setup();
    await add("m_1", "We chose Postgres for billing");
    await add("m_2", "Unrelated note about lunch");
    expect(await hasIndex()).toBe(false);

    const results = await search("postgres");
    expect(await hasIndex()).toBe(true);
    expect(results.get("m_1")).toBeGreaterThan(results.get("m_2") as number);
    const row = await db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM memories`);
    expect(Number(row?.count)).toBe(2);
  });

  it("rebuilds when the index holds a different number of memories", async () => {
    const { db, add, search } = await setup();
    await add("m_1", "We chose Postgres for billing");
    await search("postgres");
    // Write while the triggers are gone: the index now misses m_2.
    await db.run(`DROP TRIGGER memories_fts_ai`);
    await add("m_2", "Postgres replica notes");
    await add("m_other", "Unrelated note about lunch");

    const results = await search("postgres");
    expect(results.get("m_2")).toBeGreaterThan(results.get("m_other") as number);
  });

  it("rebuilds when the triggers exist but the index is short", async () => {
    const { db, add, search } = await setup();
    await add("m_1", "We chose Postgres for billing");
    await add("m_2", "Postgres replica notes");
    await search("postgres");
    await db.run(
      `DELETE FROM memories_fts_docsize WHERE id = (SELECT rowid FROM memories WHERE id = 'm_2')`
    );

    await search("postgres");
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM memories_fts_docsize`
    );
    expect(Number(row?.count)).toBe(2);
  });

  it("keeps vector results when the index cannot be built", async () => {
    const { db, add, search } = await setup();
    await add("m_1", "We chose Postgres for billing");
    await add("m_2", "Unrelated note about lunch");
    const plain = await search("postgres", 0);
    // A plain table with the index's name makes the build fail.
    await db.run(`CREATE TABLE memories_fts (x)`);

    const results = await search("postgres");
    expect(results.get("m_1")).toBe(plain.get("m_1"));
    expect(results.size).toBe(plain.size);
  });

  it("returns a memory found only by its words", async () => {
    const { db, add } = await setup();
    await add("m_1", "We chose Postgres for billing");
    await add("m_2", "Unrelated note about lunch");
    const { searchKeywords } = await import("../src/services/turso/keyword-search.js");
    const hits = await searchKeywords(db, "postgres", CONTAINER, 10);
    expect([...(hits?.scores.keys() ?? [])]).toEqual(["m_1"]);
    expect(hits?.best).toBeGreaterThan(0);
    expect(await searchKeywords(db, "postgres", "other_container", 10)).toEqual({
      scores: new Map(),
      best: 0,
    });
  });

  it("does not raise on syntax characters in the prompt", async () => {
    const { add, search } = await setup();
    await add("m_1", "We chose Postgres for billing");
    for (const text of ['"', "*", "(", "AND", "NEAR", 'NEAR("a" "b") AND * (']) {
      const results = await search(text);
      expect(results.has("m_1")).toBe(true);
    }
  });
});
