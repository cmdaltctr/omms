import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the memory client (storage port slice M2): add, search, list, session
// read, replace and delete through the client's public API on a real store in its own folder.
// Only the embedding model is stubbed. Each text maps to an angle on axes 0 and 1, so the
// search order does not depend on the shared test home's embedding dimensions.
const ANGLES: Record<string, number> = {
  "alpha harbour lantern": 10,
  "bravo meadow compass": 30,
  "charlie orchard kettle": 50,
  "delta quarry violin": 70,
  "echo memorised snapshot": 20,
  "foxtrot other project": 5,
  "golf user scope": 15,
  "query for the golden order": 0,
};
const dims = 4;
function embed(text: string): Float32Array {
  // A wrong-length vector makes the row insert fail inside the replace transaction.
  if (text === "BREAK THE INSERT") return new Float32Array(dims + 3).fill(0.5);
  const angle = ((ANGLES[text] ?? 80) * Math.PI) / 180;
  const vector = new Float32Array(dims);
  vector[0] = Math.cos(angle);
  vector[1] = Math.sin(angle);
  return vector;
}
const embeddingStub = {
  embedWithTimeout: async (text: string) => embed(text),
  warmup: async () => {},
  isWarmedUp: true,
  initError: null,
};
mock.module("../src/services/embedding.js", () => ({
  embeddingService: embeddingStub,
  EmbeddingService: { getInstance: () => embeddingStub },
  applyEmbeddingTaskPrefix: (_model: string, text: string) => text,
  loadLocalTransformersBackend: async () => null,
}));

const { CONFIG } = await import("../src/config.js");
const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
const { memoryClient } = await import("../src/services/client.js");
const { currentEmbedding } = await import("../src/services/embedding-change.js");

const HASH = "c0ffee00d00dfeed";
const TAG = `omms_project_${HASH}`;
const OTHER_TAG = "omms_project_0badc0de0badc0de";
const USER_TAG = "omms_user_1234567890abcdef";
const rootPath = CONFIG.storagePath;
const rootDims = CONFIG.embeddingDimensions;
const folders: string[] = [];

/** Points the store at a new empty folder. Every path is read per call, so this is a switch. */
async function useFolder(folder?: string): Promise<string> {
  mkdirSync(rootPath, { recursive: true });
  const target = folder ?? mkdtempSync(join(rootPath, "memory-client-"));
  if (!folder) folders.push(target);
  CONFIG.storagePath = target;
  CONFIG.embeddingDimensions = dims;
  await resetStoreHandles();
  memoryClient.reset();
  return target;
}

afterEach(async () => {
  CONFIG.storagePath = rootPath;
  CONFIG.embeddingDimensions = rootDims;
  await resetStoreHandles();
  memoryClient.reset();
});
afterAll(async () => {
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
});

const searchConfig = () => ({
  ...CONFIG,
  maxMemories: 10,
  similarityThreshold: 0,
  keywordBoost: 0,
  keywordMode: "boost" as const,
  rerankerEnabled: false,
});

async function add(
  text: string,
  id: string,
  tag = TAG,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const result = await memoryClient.addMemory(text, tag, { id, ...extra });
  expect(result.success ? result.id : result.error).toBe(id);
  // Distinct `created_at` values, so newest-first orders never tie.
  await Bun.sleep(3);
}

/** Opens the store's raw libSQL files, outside the engine. */
function raw(path: string) {
  return createClient({ url: `file:${path}` });
}

async function shardRows(folder: string) {
  const meta = raw(join(folder, "metadata.db"));
  try {
    const result = await meta.execute(
      "SELECT scope, scope_hash, db_path, vector_count FROM shards ORDER BY id"
    );
    return result.rows.map((row) => ({
      scope: String(row.scope),
      hash: String(row.scope_hash),
      // The registry keeps each shard path relative to the store folder.
      dbPath: join(folder, String(row.db_path)),
      relative: String(row.db_path),
      count: Number(row.vector_count),
    }));
  } finally {
    meta.close();
  }
}

async function rawRow(dbPath: string, id: string) {
  const db = raw(dbPath);
  try {
    const result = await db.execute({
      sql: "SELECT id, content, is_pinned, type FROM memories WHERE id = ?",
      args: [id],
    });
    const row = result.rows[0];
    return row
      ? { id: String(row.id), content: String(row.content), pinned: Number(row.is_pinned) }
      : null;
  } finally {
    db.close();
  }
}

async function seed(): Promise<string> {
  const folder = await useFolder();
  await add("charlie orchard kettle", "mem_c", TAG, { sessionID: "s-1" });
  await add("alpha harbour lantern", "mem_a", TAG, { sessionID: "s-1" });
  await add("delta quarry violin", "mem_d", TAG, { sessionID: "s-2" });
  await add("bravo meadow compass", "mem_b", TAG, { sessionID: "s-1" });
  await add("echo memorised snapshot", "ms-echo", TAG, { sessionID: "s-1", type: "memorisation" });
  await add("foxtrot other project", "mem_f", OTHER_TAG, { sessionID: "s-1" });
  await add("golf user scope", "mem_g", USER_TAG, { sessionID: "s-1" });
  return folder;
}

describe("memory client characterisation", () => {
  it("search returns the golden ids in the golden order", async () => {
    await seed();
    const query = "query for the golden order";
    const project = await memoryClient.searchMemories(query, TAG, "project", {
      config: searchConfig(),
    });
    expect(project.success).toBe(true);
    expect(project.results.map((r) => r.id)).toEqual(["mem_a", "mem_b", "mem_c", "mem_d"]);

    const linkedToo = await memoryClient.searchMemories(query, TAG, "project", {
      config: searchConfig(),
      includeLinked: true,
    });
    expect(linkedToo.results.map((r) => r.id)).toEqual(["mem_a", "mem_b", "mem_c", "mem_d"]);

    const everyProject = await memoryClient.searchMemories(query, TAG, "all-projects", {
      config: searchConfig(),
    });
    expect(everyProject.results.map((r) => r.id)).toEqual([
      "mem_f",
      "mem_a",
      "mem_g",
      "mem_b",
      "mem_c",
      "mem_d",
    ]);

    const limited = await memoryClient.searchMemories(query, TAG, "project", {
      config: searchConfig(),
      limit: 2,
    });
    expect(limited.results.map((r) => r.id)).toEqual(["mem_a", "mem_b"]);

    const memorised = await memoryClient.searchMemories(query, TAG, "project", {
      config: searchConfig(),
      kind: "memorisation",
    });
    expect(memorised.results.map((r) => r.id)).toEqual(["ms-echo"]);
  });

  it("list returns the newest rows first, within the limit and the kind", async () => {
    await seed();
    const listed = await memoryClient.listMemories(TAG, 3);
    expect(listed.success).toBe(true);
    expect(listed.memories.map((m: { id: string }) => m.id)).toEqual(["mem_b", "mem_d", "mem_a"]);

    const all = await memoryClient.listMemories(TAG, 10, "all-projects");
    expect(all.memories.map((m: { id: string }) => m.id)).toEqual([
      "mem_g",
      "mem_f",
      "mem_b",
      "mem_d",
      "mem_a",
      "mem_c",
    ]);

    const memorised = await memoryClient.listMemories(TAG, 10, "project", { kind: "memorisation" });
    expect(memorised.memories.map((m: { id: string }) => m.id)).toEqual(["ms-echo"]);
  });

  it("a session read returns that session's rows of one kind, newest first", async () => {
    await seed();
    const read = await memoryClient.searchMemoriesBySessionID("s-1", TAG, 10);
    expect(read.success).toBe(true);
    expect(read.results.map((r) => r.id)).toEqual(["mem_b", "mem_a", "mem_c"]);
    expect(read.results[0]).toMatchObject({
      memory: "bravo meadow compass",
      similarity: 1,
      containerTag: TAG,
    });

    const limited = await memoryClient.searchMemoriesBySessionID("s-1", TAG, 2);
    expect(limited.results.map((r) => r.id)).toEqual(["mem_b", "mem_a"]);

    const memorised = await memoryClient.searchMemoriesBySessionID("s-1", TAG, 10, "memorisation");
    expect(memorised.results.map((r) => r.id)).toEqual(["ms-echo"]);
  });

  it("add writes one row and counts it; delete removes it and uncounts it", async () => {
    const folder = await seed();
    const shards = await shardRows(folder);
    const project = shards.find((s) => s.scope === "project" && s.hash === HASH)!;
    expect(project.count).toBe(5);
    expect(await rawRow(project.dbPath, "mem_a")).toMatchObject({
      content: "alpha harbour lantern",
    });

    const deleted = await memoryClient.deleteMemory("mem_a", searchConfig() as never);
    expect(deleted).toEqual({ success: true });
    expect(await rawRow(project.dbPath, "mem_a")).toBeNull();
    const after = (await shardRows(folder)).find((s) => s.dbPath === project.dbPath)!;
    expect(after.count).toBe(4);

    const missing = await memoryClient.deleteMemory("mem_none", searchConfig() as never);
    expect(missing).toEqual({ success: false, error: "Memory not found" });
  });

  it("replace keeps the pin, keeps the count, and rolls back on a failed insert", async () => {
    const folder = await seed();
    const project = (await shardRows(folder)).find(
      (s) => s.scope === "project" && s.hash === HASH
    )!;
    const db = raw(project.dbPath);
    await db.execute({ sql: "UPDATE memories SET is_pinned = 1 WHERE id = ?", args: ["ms-echo"] });
    db.close();

    const replaced = await memoryClient.addMemory("echo replaced text", TAG, {
      id: "ms-echo",
      replaceExisting: true,
      type: "memorisation",
    });
    expect(replaced).toEqual({ success: true, id: "ms-echo" });
    expect(await rawRow(project.dbPath, "ms-echo")).toEqual({
      id: "ms-echo",
      content: "echo replaced text",
      pinned: 1,
    });
    expect((await shardRows(folder)).find((s) => s.dbPath === project.dbPath)!.count).toBe(5);

    const failed = await memoryClient.addMemory("BREAK THE INSERT", TAG, {
      id: "ms-echo",
      replaceExisting: true,
      type: "memorisation",
    });
    expect(failed.success).toBe(false);
    expect(await rawRow(project.dbPath, "ms-echo")).toEqual({
      id: "ms-echo",
      content: "echo replaced text",
      pinned: 1,
    });
  });

  it("follows a store folder switch on every call and writes nothing in the wrong folder", async () => {
    const folderA = await seed();
    const before = await memoryClient.listMemories(TAG, 10, "all-projects");

    const folderB = await useFolder();
    const empty = await memoryClient.listMemories(TAG, 10, "all-projects");
    expect(empty).toMatchObject({ success: true, memories: [] });
    await add("alpha harbour lantern", "mem_b_only", TAG, { sessionID: "s-1" });
    const inB = await memoryClient.searchMemories("query for the golden order", TAG, "project", {
      config: searchConfig(),
    });
    expect(inB.results.map((r) => r.id)).toEqual(["mem_b_only"]);
    const shardsB = await shardRows(folderB);
    expect(shardsB.map((s) => existsSync(s.dbPath))).toEqual([true]);
    expect(existsSync(join(folderA, shardsB[0]!.relative))).toBe(true); // A's own shard of TAG

    await useFolder(folderA);
    const after = await memoryClient.listMemories(TAG, 10, "all-projects");
    expect(after.success).toBe(true);
    expect(after.memories.map((m: { id: string }) => m.id)).toEqual(
      before.memories.map((m: { id: string }) => m.id)
    );
    // B holds only its own registry and its one shard: nothing of A's leaked there.
    expect((await shardRows(folderB)).map((s) => s.count)).toEqual([1]);
    const shardFilesB = readdirSync(join(folderB, "projects")).filter((n) => n.endsWith(".db"));
    expect(shardFilesB).toEqual([shardsB[0]!.relative.split("/")[1]!]);
  });

  it("the embedding page counts every stored row of both scopes", async () => {
    await seed();
    const current = await currentEmbedding({
      ...CONFIG,
      embeddingApiUrl: undefined,
    } as never);
    expect(current.memoryCount).toBe(7);
  });
});
