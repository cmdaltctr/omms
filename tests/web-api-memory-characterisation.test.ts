import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtempSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the memory web API on a real temp store (modularity-follow-ups M1).
// The handlers read and write through the storage port; these tests pin what they return
// and what lands on disk. Writes are read back with a raw libSQL client, not the engine.
// Every vector uses axes 0 and 1 only, and the test sets its own dimensions.

const DIMS = 4;
const PROJECT_A = "a1a2a3a4a5a6a7a8";
const PROJECT_B = "b1b2b3b4b5b6b7b8";
const USER_HASH = "c1c2c3c4c5c6c7c8";
const TAG_A = `opencode_project_${PROJECT_A}`;
const TAG_B = `opencode_project_${PROJECT_B}`;
const TAG_USER = `opencode_user_${USER_HASH}`;

const { CONFIG } = await import("../src/config.js");
const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const { embeddingService } = await import("../src/services/embedding.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const api = await import("../src/services/api-handlers.js");

function vec(a: number, b: number): Float32Array {
  const v = new Float32Array(DIMS);
  v[0] = a;
  v[1] = b;
  return v;
}

const folders: string[] = [];
const embedInputs: string[] = [];
const calls: Record<string, unknown[][]> = {};
let queryVector = vec(1, 0);
let promptsForSearch: any[] = [];
const originals = {
  warmup: embeddingService.warmup,
  embedWithTimeout: embeddingService.embedWithTimeout,
  searchPrompts: userPromptManager.searchPrompts,
  getPromptsByIds: userPromptManager.getPromptsByIds,
  getCapturedPrompts: userPromptManager.getCapturedPrompts,
  deletePrompt: userPromptManager.deletePrompt,
};

function record(name: string, args: unknown[]): void {
  (calls[name] ??= []).push(args);
}

beforeEach(() => {
  embedInputs.length = 0;
  for (const key of Object.keys(calls)) delete calls[key];
  queryVector = vec(1, 0);
  promptsForSearch = [];
  embeddingService.warmup = async () => {};
  embeddingService.embedWithTimeout = (async (text: string) => {
    embedInputs.push(text);
    return queryVector;
  }) as typeof embeddingService.embedWithTimeout;
  userPromptManager.searchPrompts = (async (...args: unknown[]) => {
    record("searchPrompts", args);
    return promptsForSearch;
  }) as typeof userPromptManager.searchPrompts;
  userPromptManager.getPromptsByIds = (async () => []) as typeof userPromptManager.getPromptsByIds;
  userPromptManager.getCapturedPrompts = (async (...args: unknown[]) => {
    record("getCapturedPrompts", args);
    return [];
  }) as typeof userPromptManager.getCapturedPrompts;
  userPromptManager.deletePrompt = (async (...args: unknown[]) => {
    record("deletePrompt", args);
  }) as typeof userPromptManager.deletePrompt;
});

afterEach(async () => {
  Object.assign(embeddingService, {
    warmup: originals.warmup,
    embedWithTimeout: originals.embedWithTimeout,
  });
  Object.assign(userPromptManager, {
    searchPrompts: originals.searchPrompts,
    getPromptsByIds: originals.getPromptsByIds,
    getCapturedPrompts: originals.getCapturedPrompts,
    deletePrompt: originals.deletePrompt,
  });
  await closeTursoAndInvalidateCaches();
  for (const folder of folders.splice(0)) await cleanupTursoTestDirectory(folder);
});

/** Points the store at a fresh temp folder (or `folder`) and drops every cached handle. */
async function useFolder(folder?: string): Promise<string> {
  const dir = folder ?? mkdtempSync(join(tmpdir(), "web-api-memory-"));
  if (!folder) folders.push(dir);
  CONFIG.storagePath = dir;
  CONFIG.embeddingDimensions = DIMS;
  await closeTursoAndInvalidateCaches();
  return dir;
}

interface Seed {
  id: string;
  tag: string;
  vector?: Float32Array;
  createdAt?: number;
  [field: string]: unknown;
}

/** Seeds one row with the engine, as a capture would, and counts it in the registry. */
async function seed(row: Seed): Promise<void> {
  const [, scope, hash] = row.tag.split("_") as [string, "user" | "project", string];
  const shard = await tursoShardManager.getWriteShard(scope, hash);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  const { id, tag, vector, createdAt, ...extra } = row;
  await tursoVectorSearch.insertVector(db, {
    id,
    content: `content of ${id}`,
    vector: vector ?? vec(1, 0),
    containerTag: tag,
    createdAt: createdAt ?? 1_700_000_000_000,
    updatedAt: createdAt ?? 1_700_000_000_000,
    ...extra,
  });
  await tursoShardManager.incrementVectorCount(shard.id);
}

/** Every registry row and every `memories` row in a folder, read with a raw client. */
async function readFolder(dir: string) {
  const meta = createClient({ url: `file:${join(dir, "metadata.db")}` });
  const shards = (
    await meta.execute("SELECT scope, scope_hash, db_path, vector_count FROM shards ORDER BY id")
  ).rows.map((r) => ({ ...r }));
  meta.close();
  const rows: Record<string, unknown>[] = [];
  for (const shard of shards) {
    const path = join(dir, `${String(shard.scope)}s`, basename(String(shard.db_path)));
    const db = createClient({ url: `file:${path}` });
    const result = await db.execute(
      "SELECT id, content, container_tag, tags, type, metadata, project_path, is_pinned, created_at FROM memories ORDER BY id"
    );
    rows.push(...result.rows.map((r) => ({ ...r, shard: `${shard.scope}:${shard.scope_hash}` })));
    db.close();
  }
  return { shards, rows };
}

describe("memory web API on a real store", () => {
  it("adds a memory to the scope's write shard and counts it", async () => {
    const dir = await useFolder();
    const result = await api.handleAddMemory({
      content: "remember the alpha plan",
      containerTag: TAG_A,
      type: "decision" as never,
      tags: [" Alpha ", "Beta"],
      projectPath: "/work/alpha",
    });
    expect(result.success).toBe(true);
    expect(result.data?.id).toMatch(/^mem_\d+_[a-z0-9]+$/);
    expect(embedInputs).toEqual([
      "remember the alpha plan\nTags: alpha, beta",
      "Topics: alpha, beta",
    ]);

    const { shards, rows } = await readFolder(dir);
    expect(shards).toEqual([
      {
        scope: "project",
        scope_hash: PROJECT_A,
        db_path: expect.stringContaining(`projects`),
        vector_count: 1,
      },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        id: result.data?.id,
        content: "remember the alpha plan",
        container_tag: TAG_A,
        tags: "alpha,beta",
        type: "decision",
        metadata: JSON.stringify({ source: "api" }),
        project_path: "/work/alpha",
        is_pinned: 0,
        shard: `project:${PROJECT_A}`,
      }),
    ]);
  });

  it("deletes a user-scope memory, lowers the count and cascades the linked prompt", async () => {
    const dir = await useFolder();
    await seed({ id: "mem_keep", tag: TAG_A });
    await seed({ id: "mem_gone", tag: TAG_USER, metadata: JSON.stringify({ promptId: "p_1" }) });

    expect(await api.handleDeleteMemory("mem_gone", true)).toEqual({
      success: true,
      data: { deletedPrompt: true },
    });
    expect(calls.deletePrompt).toEqual([["p_1"]]);
    const { shards, rows } = await readFolder(dir);
    expect(rows.map((r) => r.id)).toEqual(["mem_keep"]);
    expect(shards.map((s) => [s.scope, s.vector_count])).toEqual([
      ["project", 1],
      ["user", 0],
    ]);
    expect(await api.handleDeleteMemory("mem_gone")).toEqual({
      success: false,
      error: "Memory not found",
    });
  });

  it("pins and unpins a user-scope memory", async () => {
    const dir = await useFolder();
    await seed({ id: "mem_pin", tag: TAG_USER });

    expect(await api.handlePinMemory("mem_pin")).toEqual({ success: true });
    expect((await readFolder(dir)).rows[0]?.is_pinned).toBe(1);
    expect(await api.handleUnpinMemory("mem_pin")).toEqual({ success: true });
    expect((await readFolder(dir)).rows[0]?.is_pinned).toBe(0);
    expect(await api.handlePinMemory("mem_none")).toEqual({
      success: false,
      error: "Memory not found",
    });
  });

  it("updates a memory in place and keeps its pin and creation time", async () => {
    const dir = await useFolder();
    await seed({ id: "mem_edit", tag: TAG_A, tags: "old", type: "decision" });
    await api.handlePinMemory("mem_edit");

    expect(
      await api.handleUpdateMemory("mem_edit", { content: "new text", tags: ["fresh"] })
    ).toEqual({
      success: true,
    });
    expect(embedInputs).toEqual(["new text", "Topics: fresh"]);
    const { shards, rows } = await readFolder(dir);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "mem_edit",
        content: "new text",
        tags: "fresh",
        type: "decision",
        is_pinned: 1,
        created_at: 1_700_000_000_000,
      }),
    ]);
    expect(shards.map((s) => s.vector_count)).toEqual([1]);
  });

  it("lists project tags with the first row's details and leaves user tags out", async () => {
    await useFolder();
    await seed({ id: "mem_a1", tag: TAG_A, projectPath: "/work/alpha", projectName: "alpha" });
    await seed({ id: "mem_b1", tag: TAG_B, displayName: "Beta display" });
    await seed({ id: "mem_u1", tag: TAG_USER, projectPath: "/home" });

    const result = await api.handleListTags();
    expect(result.success).toBe(true);
    expect(result.data?.project.map((t) => [t.tag, t.projectPath, t.displayName]).sort()).toEqual([
      [TAG_A, "/work/alpha", undefined],
      [TAG_B, undefined, "Beta display"],
    ]);
  });

  it("counts normal memories of both scopes by type and leaves memorisations out", async () => {
    await useFolder();
    await seed({ id: "mem_s1", tag: TAG_A, type: "decision", tags: "alpha,beta" });
    await seed({ id: "mem_s2", tag: TAG_B, type: "bug-fix", tags: "alpha" });
    await seed({ id: "mem_s3", tag: TAG_USER, type: "decision" });
    await seed({ id: "mem_s4", tag: TAG_A, type: "memorisation" });

    expect(await api.handleStats()).toEqual({
      success: true,
      data: {
        total: 3,
        byScope: { user: 1, project: 2 },
        byType: { decision: 2, "bug-fix": 1 },
      },
    });
    const keywords = await api.handleListKeywords();
    expect(keywords.success).toBe(true);
    expect(keywords.data?.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "alpha", count: 2 }),
        expect.objectContaining({ keyword: "beta", count: 1 }),
      ])
    );
  });

  it("lists a tag's memories and asks for prompts by the tag's project path", async () => {
    await useFolder();
    await seed({
      id: "mem_l1",
      tag: TAG_A,
      projectPath: "/work/alpha",
      createdAt: 1_700_000_000_001,
    });
    await seed({ id: "mem_l2", tag: TAG_A, createdAt: 1_700_000_000_002 });
    await seed({ id: "mem_l3", tag: TAG_USER });

    const scoped = await api.handleListMemories(TAG_A, 1, 20, true);
    expect(scoped.success).toBe(true);
    expect(scoped.data?.items.map((i: any) => i.id)).toEqual(["mem_l2", "mem_l1"]);
    expect(calls.getCapturedPrompts).toEqual([["/work/alpha"]]);

    const everything = await api.handleListMemories(undefined, 1, 20, true);
    expect(everything.data?.items.map((i: any) => i.id).sort()).toEqual([
      "mem_l1",
      "mem_l2",
      "mem_l3",
    ]);
    expect(calls.getCapturedPrompts?.[1]).toEqual([undefined]);
  });

  it("searches one tag's shards with twice the page size, best match first", async () => {
    await useFolder();
    await seed({ id: "mem_q1", tag: TAG_A, vector: vec(0, 1), projectPath: "/work/alpha" });
    await seed({ id: "mem_q2", tag: TAG_A, vector: vec(1, 0) });
    await seed({ id: "mem_q3", tag: TAG_A, vector: vec(1, 1) });
    await seed({ id: "mem_qb", tag: TAG_B, vector: vec(1, 0) });

    const result = await api.handleSearch("alpha", TAG_A, 1, 1);
    expect(result.success).toBe(true);
    expect(result.data?.total).toBe(2);
    expect(result.data?.items.map((i: any) => i.id)).toEqual(["mem_q2"]);
    expect(calls.searchPrompts).toEqual([["alpha", "/work/alpha", 2]]);
  });

  it("searches every tag of both scopes and adds a prompt's linked memory as context", async () => {
    await useFolder();
    await seed({ id: "mem_g1", tag: TAG_A, vector: vec(1, 0) });
    await seed({ id: "mem_g2", tag: TAG_A, vector: vec(0, 1) });
    await seed({
      id: "mem_gu",
      tag: TAG_USER,
      vector: vec(0, 1),
      type: "preference",
      tags: "x, y",
      metadata: JSON.stringify({ promptId: "p_9" }),
    });
    promptsForSearch = [
      {
        id: "p_9",
        sessionId: "s",
        content: "prompt",
        createdAt: 1_800_000_000_000,
        projectPath: null,
        linkedMemoryId: "mem_gu",
      },
    ];

    const result = await api.handleSearch("alpha", undefined, 1, 1);
    expect(result.success).toBe(true);
    // One hit per tag (page size 1) plus the prompt.
    expect(result.data?.total).toBe(3);
    expect(calls.searchPrompts).toEqual([["alpha", undefined, 2]]);
    expect(result.data?.items).toEqual([
      expect.objectContaining({ type: "prompt", id: "p_9" }),
      expect.objectContaining({
        type: "memory",
        id: "mem_gu",
        memoryType: "preference",
        tags: ["x", "y"],
        isPinned: false,
        linkedPromptId: "p_9",
        similarity: 0,
        isContext: true,
      }),
    ]);
  });

  it("reads and writes the folder that is active at call time", async () => {
    const first = await useFolder();
    await api.handleAddMemory({ content: "in first", containerTag: TAG_A });
    const second = mkdtempSync(join(tmpdir(), "web-api-memory-"));
    folders.push(second);
    await useFolder(second);

    expect((await api.handleStats()).data?.total).toBe(0);
    expect((await api.handleListTags()).data?.project).toEqual([]);
    await api.handleAddMemory({ content: "in second", containerTag: TAG_B });
    expect((await readFolder(second)).rows.map((r) => r.content)).toEqual(["in second"]);

    await useFolder(first);
    const firstRows = (await readFolder(first)).rows;
    expect(firstRows.map((r) => [r.content, r.container_tag])).toEqual([["in first", TAG_A]]);
    expect((await api.handleStats()).data?.total).toBe(1);
    expect(readdirSync(join(first, "projects")).filter((f) => f.endsWith(".db"))).toHaveLength(1);
  });
});
