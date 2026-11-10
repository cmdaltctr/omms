import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";
import type { MemoryKind } from "../src/services/memory-kind.js";

const HASH = "a1b2c3d4e5f67890";
const CONTAINER = `opencode_project_${HASH}`;
const IDS = ["normal-row", "memorisation-row", "legacy-row"];
const tempDirs: string[] = [];

afterEach(async () => {
  await cleanupTursoTestDirectory();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id).sort();
}

async function setupShard() {
  const baseDir = mkdtempSync(join(tmpdir(), "memorisation-kind-"));
  tempDirs.push(baseDir);
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  CONFIG.embeddingDimensions = 8;
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const shard = await tursoShardManager.createShard("project", HASH, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  const vector = new Float32Array(8);
  vector[0] = 1;
  for (const [index, id] of IDS.entries()) {
    const rowVector = new Float32Array(vector);
    rowVector[index + 1] = 0.2;
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `shared-kind-token ${id}`,
      vector: rowVector,
      tagsVector: rowVector,
      containerTag: CONTAINER,
      type: index === 1 ? "memorisation" : index === 0 ? "fact" : undefined,
      metadata: JSON.stringify({ sessionID: "kind-session" }),
      createdAt: 1000 + index,
      updatedAt: 1000 + index,
    });
  }
  return { baseDir, db, shard, vector };
}

describe("memory kind filtering in shard readers", () => {
  it("filters ANN vector search, hydration, and exact-scan fallback in SQL", async () => {
    const { db, shard, vector } = await setupShard();
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const normal = await tursoVectorSearch.searchInShard(shard, vector, CONTAINER, 10);
    expect(ids(normal)).toEqual(["legacy-row", "normal-row"]);
    const memorised = await tursoVectorSearch.searchInShard(
      shard,
      vector,
      CONTAINER,
      10,
      undefined,
      0,
      "boost",
      undefined,
      "memorisation"
    );
    expect(ids(memorised)).toEqual(["memorisation-row"]);

    await db.run(`DROP INDEX memories_vec_idx`);
    await db.run(`DROP INDEX memories_tags_vec_idx`);
    const fallback = await tursoVectorSearch.searchInShard(shard, vector, CONTAINER, 10);
    expect(ids(fallback)).toEqual(["legacy-row", "normal-row"]);
    const fallbackMemorised = await tursoVectorSearch.searchInShard(
      shard,
      vector,
      CONTAINER,
      10,
      undefined,
      0,
      "boost",
      undefined,
      "memorisation"
    );
    expect(ids(fallbackMemorised)).toEqual(["memorisation-row"]);
  });

  it("filters keyword search, list, and session reads, including NULL legacy types", async () => {
    const { db } = await setupShard();
    const { searchKeywords } = await import("../src/services/turso/keyword-search.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    for (const [kind, expected] of [
      ["normal", ["legacy-row", "normal-row"]],
      ["memorisation", ["memorisation-row"]],
    ] as const) {
      const keywords = await searchKeywords(db, "shared-kind-token", CONTAINER, 10, kind);
      expect([...(keywords?.scores.keys() ?? [])].sort()).toEqual(expected);
      expect(ids(await tursoVectorSearch.listMemories(db, CONTAINER, 10, kind))).toEqual(expected);
      expect(ids(await tursoVectorSearch.getMemoriesBySessionID(db, "kind-session", kind))).toEqual(
        expected
      );
    }
  });

  it("propagates kind through client search, reranked search, list, and session reads", async () => {
    const { memoryClient } = await import("../src/services/client.js");
    const { embeddingService } = await import("../src/services/embedding.js");
    const { CONFIG } = await import("../src/config.js");
    const originalEmbed = embeddingService.embedWithTimeout;
    const vector = new Float32Array(8);
    vector[0] = 1;
    (embeddingService as any).embedWithTimeout = async () => vector;
    const previous = {
      rerankerEnabled: CONFIG.rerankerEnabled,
      rerankerApiUrl: CONFIG.rerankerApiUrl,
      rerankerModel: CONFIG.rerankerModel,
      similarityThreshold: CONFIG.similarityThreshold,
      keywordBoost: CONFIG.keywordBoost,
    };
    Object.assign(CONFIG, {
      rerankerEnabled: false,
      similarityThreshold: 0,
      keywordBoost: 0.2,
    });
    try {
      await setupShard();
      const normal = await memoryClient.searchMemories("shared-kind-token", CONTAINER);
      expect(normal.success).toBe(true);
      expect(ids(normal.results)).toEqual(["legacy-row", "normal-row"]);
      const memorised = await memoryClient.searchMemories(
        "shared-kind-token",
        CONTAINER,
        "project",
        {
          kind: "memorisation",
        }
      );
      expect(ids(memorised.results)).toEqual(["memorisation-row"]);
      expect(ids((await memoryClient.listMemories(CONTAINER)).memories)).toEqual([
        "legacy-row",
        "normal-row",
      ]);
      expect(
        ids(
          (
            await memoryClient.listMemories(CONTAINER, 10, "project", {
              kind: "memorisation",
            })
          ).memories
        )
      ).toEqual(["memorisation-row"]);
      expect(
        ids((await memoryClient.searchMemoriesBySessionID("kind-session", CONTAINER)).results)
      ).toEqual(["legacy-row", "normal-row"]);
      expect(
        ids(
          (
            await memoryClient.searchMemoriesBySessionID(
              "kind-session",
              CONTAINER,
              10,
              "memorisation"
            )
          ).results
        )
      ).toEqual(["memorisation-row"]);

      Object.assign(CONFIG, {
        rerankerEnabled: true,
        rerankerApiUrl: "http://127.0.0.1:1/v1",
        rerankerModel: "unused-test-model",
      });
      const reranked = await memoryClient.searchMemories(
        "shared-kind-token",
        CONTAINER,
        "project",
        {
          kind: "memorisation",
        }
      );
      expect(reranked.success).toBe(true);
      expect(ids(reranked.results)).toEqual(["memorisation-row"]);
    } finally {
      (embeddingService as any).embedWithTimeout = originalEmbed;
      Object.assign(CONFIG, previous);
    }
  });
});

describe("memory kind filtering in linked spaces", () => {
  it("filters real linked search and list reads and propagates the client option", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memorisation-linked-"));
    tempDirs.push(dir);
    const scenario = join(dir, "scenario.mjs");
    writeFileSync(
      scenario,
      `
import { mock } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
process.env.HOME = ${JSON.stringify(join(dir, "home"))};
const root = ${JSON.stringify(dir)};
const home = join(root, "home");
const alpha = join(home, ".omms", "spaces", "kind-alpha");
const beta = join(home, ".omms", "spaces", "kind-beta");
mkdirSync(alpha, { recursive: true });
mkdirSync(beta, { recursive: true });
writeFileSync(join(home, ".omms", "spaces.json"), JSON.stringify({
  version: 1,
  activeSpaceId: "kind-alpha",
  spaces: [
    { id: "kind-alpha", name: "Alpha", createdAt: "2026-01-01T00:00:00Z", archived: false, links: ["kind-beta"] },
    { id: "kind-beta", name: "Beta", createdAt: "2026-01-01T00:00:00Z", archived: false },
  ],
}));
const { embeddingService } = await import(${JSON.stringify(new URL("../src/services/embedding.js", import.meta.url).href)});
const vector = new Float32Array(8);
vector[0] = 1;
mock.module(${JSON.stringify(new URL("../src/services/embedding.js", import.meta.url).href)}, () => ({
  embeddingService: { ...embeddingService, embedWithTimeout: async () => vector },
}));
const { CONFIG, initConfig } = await import(${JSON.stringify(new URL("../src/config.js", import.meta.url).href)});
mkdirSync(join(home, ".config", "omms"), { recursive: true });
writeFileSync(join(home, ".config", "omms", "omms.jsonc"), JSON.stringify({ embeddingDimensions: 8 }));
initConfig(root);
CONFIG.embeddingDimensions = 8;
Object.assign(CONFIG, { similarityThreshold: 0, keywordBoost: 0.2, rerankerEnabled: false });
const { openSpaceStore } = await import(${JSON.stringify(new URL("../src/services/spaces/space-store.js", import.meta.url).href)});
const { tursoVectorSearch } = await import(${JSON.stringify(new URL("../src/services/turso/vector-search.js", import.meta.url).href)});
const store = openSpaceStore(beta, "write");
const shard = await store.shards.getWriteShard("project", ${JSON.stringify(HASH)});
const db = await store.connections.getConnection(shard.dbPath);
for (const [index, id] of ${JSON.stringify(IDS)}.entries()) {
  const rowVector = new Float32Array(vector);
  rowVector[index + 1] = 0.2;
  await tursoVectorSearch.insertVector(db, {
    id: "linked-" + id,
    content: "shared-kind-token " + id,
    vector: rowVector,
    tagsVector: rowVector,
    containerTag: ${JSON.stringify(CONTAINER)},
    type: index === 1 ? "memorisation" : index === 0 ? "fact" : undefined,
    createdAt: 1000 + index,
    updatedAt: 1000 + index,
  });
}
await store.close();
const { memoryClient } = await import(${JSON.stringify(new URL("../src/services/client.js", import.meta.url).href)});
const normal = await memoryClient.searchMemories("shared-kind-token", ${JSON.stringify(CONTAINER)}, "project", { includeLinked: true });
const memorised = await memoryClient.searchMemories("shared-kind-token", ${JSON.stringify(CONTAINER)}, "project", { includeLinked: true, kind: "memorisation" });
const normalList = await memoryClient.listMemories(${JSON.stringify(CONTAINER)}, 10, "project", { includeLinked: true });
const memorisedList = await memoryClient.listMemories(${JSON.stringify(CONTAINER)}, 10, "project", { includeLinked: true, kind: "memorisation" });
const { closeAllCachedSpaceReadStores } = await import(${JSON.stringify(new URL("../src/services/spaces/read-store-cache.js", import.meta.url).href)});
await closeAllCachedSpaceReadStores();
console.log(JSON.stringify({
  normal: normal.results.map((row) => row.id).sort(),
  memorised: memorised.results.map((row) => row.id).sort(),
  normalList: normalList.memories.map((row) => row.id).sort(),
  memorisedList: memorisedList.memories.map((row) => row.id).sort(),
}));
`
    );
    const result = Bun.spawnSync(["bun", scenario], {
      env: { ...process.env, HOME: join(dir, "home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(result.stdout).trim();
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    const output = JSON.parse(stdout.split("\n").pop()!);
    expect(output.normal).toEqual(["linked-legacy-row", "linked-normal-row"]);
    expect(output.memorised).toEqual(["linked-memorisation-row"]);
    expect(output.normalList).toEqual(["linked-legacy-row", "linked-normal-row"]);
    expect(output.memorisedList).toEqual(["linked-memorisation-row"]);
  });
});

describe("memoryKindPredicate", () => {
  it("uses NULL-safe normal filtering and exact memorisation filtering", async () => {
    const { memoryKindPredicate } = await import("../src/services/memory-kind.js");
    const cases: Array<[MemoryKind | undefined, string]> = [
      [undefined, "type IS NOT 'memorisation'"],
      ["normal", "type IS NOT 'memorisation'"],
      ["memorisation", "type = 'memorisation'"],
    ];
    for (const [kind, expected] of cases) expect(memoryKindPredicate("type", kind)).toBe(expected);
  });
});
