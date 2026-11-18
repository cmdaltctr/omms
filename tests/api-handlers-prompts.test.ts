import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

describe("api handlers: prompt deletion", () => {
  let baseDir: string;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  async function openStore() {
    baseDir = mkdtempSync(join(tmpdir(), "api-prompts-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    CONFIG.embeddingDimensions = 768;

    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();

    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");
    const vector = new Float32Array(768);
    vector[0] = 1;
    const shard = await tursoShardManager.createShard("project", "d1d2d3d4d5d6d7d8", 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);

    /** Saves a prompt and, when asked, a memory linked to it. */
    async function seedPrompt(name: string, withMemory: boolean) {
      const promptId = await userPromptManager.savePrompt(`s-${name}`, `m-${name}`, "/p", name);
      if (withMemory) {
        await tursoVectorSearch.insertVector(db, {
          id: `mem_${name}`,
          content: `memory ${name}`,
          vector,
          containerTag: "opencode_project_d1d2d3d4d5d6d7d8",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await userPromptManager.linkMemoryToPrompt(promptId, `mem_${name}`);
      }
      return promptId;
    }
    return { seedPrompt, userPromptManager, db, tursoVectorSearch };
  }

  it("deletes a prompt and keeps its linked memory when cascade is off", async () => {
    const { seedPrompt, userPromptManager, db, tursoVectorSearch } = await openStore();
    const promptId = await seedPrompt("keep", true);

    const { handleDeletePrompt } = await import("../src/services/api-handlers.js");
    const result = await handleDeletePrompt(promptId);

    expect(result).toEqual({ success: true, data: { deletedMemory: false } });
    expect(await userPromptManager.getPromptById(promptId)).toBeNull();
    expect(await tursoVectorSearch.getMemoryById(db, "mem_keep")).toBeTruthy();
  });

  it("deletes the linked memory too when cascade is on", async () => {
    const { seedPrompt, userPromptManager, db, tursoVectorSearch } = await openStore();
    const promptId = await seedPrompt("cascade", true);

    const { handleDeletePrompt } = await import("../src/services/api-handlers.js");
    const result = await handleDeletePrompt(promptId, true);

    expect(result).toEqual({ success: true, data: { deletedMemory: true } });
    expect(await userPromptManager.getPromptById(promptId)).toBeNull();
    expect(await tursoVectorSearch.getMemoryById(db, "mem_cascade")).toBeFalsy();
  });

  it("refuses an empty id and an unknown prompt", async () => {
    await openStore();
    const { handleDeletePrompt } = await import("../src/services/api-handlers.js");

    expect(await handleDeletePrompt("")).toEqual({ success: false, error: "id is required" });
    expect(await handleDeletePrompt("prompt_missing")).toEqual({
      success: false,
      error: "Prompt not found",
    });
  });

  it("bulk deletes prompts, counts only those that existed, and rejects an empty list", async () => {
    const { seedPrompt, userPromptManager } = await openStore();
    const first = await seedPrompt("bulk1", false);
    const second = await seedPrompt("bulk2", false);

    const { handleBulkDeletePrompts } = await import("../src/services/api-handlers.js");
    expect(await handleBulkDeletePrompts([])).toEqual({
      success: false,
      error: "ids array is required",
    });

    const result = await handleBulkDeletePrompts([first, "prompt_missing", second]);

    expect(result).toEqual({ success: true, data: { deleted: 2 } });
    expect(await userPromptManager.getPromptById(first)).toBeNull();
    expect(await userPromptManager.getPromptById(second)).toBeNull();
  });
});
