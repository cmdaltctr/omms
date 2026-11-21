import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

describe("memory timeline listing", () => {
  let baseDir: string;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("keeps memories whose linked prompt is missing from the timeline", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "timeline-orphan-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;

    const { ensureTursoReady } = await import("../src/services/turso/ready.js");
    await ensureTursoReady();

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { handleListMemories } = await import("../src/services/api-handlers.js");

    const dims = CONFIG.embeddingDimensions;
    const vector = new Float32Array(dims);
    vector[0] = 1;

    const scopeHash = "a1b2c3d4e5f67890";
    const containerTag = `opencode_project_${scopeHash}`;

    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    await tursoVectorSearch.insertVector(db, {
      id: "mem_orphan_link",
      content: "Memory whose linked prompt was deleted",
      vector,
      containerTag,
      metadata: JSON.stringify({ promptId: "prompt_never_existed" }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await handleListMemories(undefined, 1, 20, true);

    expect(result.success).toBe(true);
    const data = result.data as { items: Array<{ id: string }> };
    expect(data.items.some((m) => m.id === "mem_orphan_link")).toBe(true);
  });

  it("renders linked memory-prompt pairs together in the timeline", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "timeline-pair-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;

    const { ensureTursoReady } = await import("../src/services/turso/ready.js");
    await ensureTursoReady();

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { handleListMemories } = await import("../src/services/api-handlers.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");

    const dims = CONFIG.embeddingDimensions;
    const vector = new Float32Array(dims);
    vector[0] = 1;

    const scopeHash = "a1b2c3d4e5f67890";
    const containerTag = `opencode_project_${scopeHash}`;
    const now = Date.now();

    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    const promptId = await userPromptManager.savePrompt(
      "session-pair",
      "msg-pair",
      "C:/proj",
      "captured prompt"
    );
    await userPromptManager.markAsCaptured(promptId);

    await tursoVectorSearch.insertVector(db, {
      id: "mem_linked",
      content: "Linked memory",
      vector,
      containerTag,
      metadata: JSON.stringify({ promptId }),
      createdAt: now,
      updatedAt: now,
    });
    await userPromptManager.linkMemoryToPrompt(promptId, "mem_linked");

    const result = await handleListMemories(undefined, 1, 20, true);
    expect(result.success).toBe(true);
    const items = (result.data as { items: Array<{ id: string; type: string }> }).items;
    const ids = items.map((i) => i.id);
    expect(ids).toContain("mem_linked");
    expect(ids).toContain(promptId);
    expect(ids.indexOf("mem_linked")).toBeLessThan(ids.indexOf(promptId));
  });

  it("lists the newest turns first when memories store the host message ID", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "timeline-newest-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;

    const { ensureTursoReady } = await import("../src/services/turso/ready.js");
    await ensureTursoReady();

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { handleListMemories } = await import("../src/services/api-handlers.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");

    const vector = new Float32Array(CONFIG.embeddingDimensions);
    vector[0] = 1;
    const scopeHash = "a1b2c3d4e5f67890";
    const containerTag = `opencode_project_${scopeHash}`;
    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const now = Date.now();

    // An old pair whose memory stores the OMMS prompt row ID.
    const oldPrompt = await userPromptManager.savePrompt("s", "msg-old", "C:/proj", "old prompt");
    await userPromptManager.markAsCaptured(oldPrompt);
    await tursoVectorSearch.insertVector(db, {
      id: "mem_old",
      content: "Old memory",
      vector,
      containerTag,
      metadata: JSON.stringify({ promptId: oldPrompt }),
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
    });
    await userPromptManager.linkMemoryToPrompt(oldPrompt, "mem_old");

    // A new pair: capture now stores the host message ID as promptId.
    const newPrompt = await userPromptManager.savePrompt("s", "msg-new", "C:/proj", "new prompt");
    await userPromptManager.markAsCaptured(newPrompt);
    await tursoVectorSearch.insertVector(db, {
      id: "mem_new",
      content: "New memory",
      vector,
      containerTag,
      metadata: JSON.stringify({ promptId: "msg-new" }),
      createdAt: now,
      updatedAt: now,
    });
    await userPromptManager.linkMemoryToPrompt(newPrompt, "mem_new");

    const result = await handleListMemories(undefined, 1, 2, true);
    expect(result.success).toBe(true);
    const items = (result.data as { items: Array<{ id: string; linkedPromptId?: string }> }).items;
    expect(items.map((i) => i.id)).toEqual(["mem_new", newPrompt]);
    expect(items[0].linkedPromptId).toBe(newPrompt);
  });

  it("places an unlinked newer prompt above older pairs", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "timeline-standalone-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;

    const { ensureTursoReady } = await import("../src/services/turso/ready.js");
    await ensureTursoReady();

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { handleListMemories } = await import("../src/services/api-handlers.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");

    const vector = new Float32Array(CONFIG.embeddingDimensions);
    vector[0] = 1;
    const scopeHash = "a1b2c3d4e5f67890";
    const containerTag = `opencode_project_${scopeHash}`;
    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    const pairedPrompt = await userPromptManager.savePrompt("s", "m1", "C:/proj", "paired");
    await userPromptManager.markAsCaptured(pairedPrompt);
    await tursoVectorSearch.insertVector(db, {
      id: "mem_paired",
      content: "Paired memory",
      vector,
      containerTag,
      metadata: JSON.stringify({ promptId: pairedPrompt }),
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    });
    await userPromptManager.linkMemoryToPrompt(pairedPrompt, "mem_paired");

    // Saved after the pair, so its createdAt is newer. No memory came from it.
    const lonePrompt = await userPromptManager.savePrompt("s", "m2", "C:/proj", "no memory");
    await userPromptManager.markAsCaptured(lonePrompt);

    const result = await handleListMemories(undefined, 1, 20, true);
    expect(result.success).toBe(true);
    const ids = (result.data as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(ids).toEqual([lonePrompt, "mem_paired", pairedPrompt]);
  });

  it("filters the timeline by memory keyword and keeps only linked prompts", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "timeline-keyword-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;

    const { ensureTursoReady } = await import("../src/services/turso/ready.js");
    await ensureTursoReady();

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { handleListMemories } = await import("../src/services/api-handlers.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");

    const vector = new Float32Array(CONFIG.embeddingDimensions);
    vector[0] = 1;
    const scopeHash = "a1b2c3d4e5f67890";
    const containerTag = `opencode_project_${scopeHash}`;
    const now = Date.now();
    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    const promptId = await userPromptManager.savePrompt("s", "m1", "C:/proj", "linked prompt");
    await userPromptManager.markAsCaptured(promptId);
    const otherPrompt = await userPromptManager.savePrompt("s", "m2", "C:/proj", "other prompt");
    await userPromptManager.markAsCaptured(otherPrompt);

    await tursoVectorSearch.insertVector(db, {
      id: "mem_embed",
      content: "Embedding memory",
      vector,
      containerTag,
      tags: "Embeddings, validation",
      metadata: JSON.stringify({ promptId }),
      createdAt: now,
      updatedAt: now,
    });
    await userPromptManager.linkMemoryToPrompt(promptId, "mem_embed");
    await tursoVectorSearch.insertVector(db, {
      id: "mem_other",
      content: "Unrelated memory",
      vector,
      containerTag,
      tags: "ingestion",
      createdAt: now,
      updatedAt: now,
    });

    const result = await handleListMemories(undefined, 1, 20, true, "embeddings");
    expect(result.success).toBe(true);
    const ids = (result.data as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(ids).toContain("mem_embed");
    expect(ids).toContain(promptId);
    expect(ids).not.toContain("mem_other");
    expect(ids).not.toContain(otherPrompt);
  });

  it("cascade delete removes the prompt linked to the memory", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "timeline-cascade-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;

    const { ensureTursoReady } = await import("../src/services/turso/ready.js");
    await ensureTursoReady();

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { handleDeleteMemory } = await import("../src/services/api-handlers.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");

    const vector = new Float32Array(CONFIG.embeddingDimensions);
    vector[0] = 1;
    const scopeHash = "a1b2c3d4e5f67890";
    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    const promptId = await userPromptManager.savePrompt("s", "msg-host", "C:/proj", "prompt");
    await userPromptManager.markAsCaptured(promptId);
    await tursoVectorSearch.insertVector(db, {
      id: "mem_cascade",
      content: "Memory",
      vector,
      containerTag: `opencode_project_${scopeHash}`,
      metadata: JSON.stringify({ promptId: "msg-host" }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await userPromptManager.linkMemoryToPrompt(promptId, "mem_cascade");

    const result = await handleDeleteMemory("mem_cascade", true);
    expect(result).toEqual({ success: true, data: { deletedPrompt: true } });
    expect(await userPromptManager.getPromptById(promptId)).toBeNull();
  });
});
