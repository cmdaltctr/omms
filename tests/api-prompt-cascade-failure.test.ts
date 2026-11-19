import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// A cascade prompt delete must keep the prompt when its linked memory could not be
// deleted, so the user can retry. The row delete fails here through a stub.

const realRows = await import("../src/services/storage/memory/rows.js");
mock.module("../src/services/storage/memory/rows.js", () => ({
  ...realRows,
  deleteMemoryRow: async () => {
    throw new Error("database is locked");
  },
}));

const scopeHash = "f1f2f3f4f5f6f7f8";
let baseDir: string | undefined;

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
  baseDir = undefined;
});

async function seedLinkedPrompt() {
  baseDir = mkdtempSync(join(tmpdir(), "api-prompt-cascade-"));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  CONFIG.embeddingDimensions = 8;
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");

  const shard = await tursoShardManager.createShard("project", scopeHash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  const vector = new Float32Array(8);
  vector[0] = 1;
  await tursoVectorSearch.insertVector(db, {
    id: "mem_linked",
    content: "linked memory",
    vector,
    containerTag: `opencode_project_${scopeHash}`,
    createdAt: 1000,
    updatedAt: 1000,
  });
  const promptId = await userPromptManager.savePrompt("s-1", "m-1", "/p", "prompt text");
  await userPromptManager.linkMemoryToPrompt(promptId, "mem_linked");
  return { promptId, userPromptManager, db, tursoVectorSearch };
}

describe("api handlers: cascade prompt delete when the memory delete fails", () => {
  it("keeps the prompt and reports the failure", async () => {
    const { promptId, userPromptManager, db, tursoVectorSearch } = await seedLinkedPrompt();
    const { handleDeletePrompt } = await import("../src/services/api-handlers.js");

    const result = await handleDeletePrompt(promptId, true);

    expect(result.success).toBe(false);
    expect(await userPromptManager.getPromptById(promptId)).toBeTruthy();
    expect(await tursoVectorSearch.getMemoryById(db, "mem_linked")).toBeTruthy();
  });

  it("still deletes the prompt when its linked memory is already gone", async () => {
    const { userPromptManager } = await seedLinkedPrompt();
    const orphan = await userPromptManager.savePrompt("s-2", "m-2", "/p", "orphan prompt");
    await userPromptManager.linkMemoryToPrompt(orphan, "mem_missing");
    const { handleDeletePrompt } = await import("../src/services/api-handlers.js");

    const result = await handleDeletePrompt(orphan, true);

    expect(result).toEqual({ success: true, data: { deletedMemory: false } });
    expect(await userPromptManager.getPromptById(orphan)).toBeNull();
  });
});
