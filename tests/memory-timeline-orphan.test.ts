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
});
