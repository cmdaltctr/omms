import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const { CONFIG } = await import("../src/config.js");
const { CleanupService } = await import("../src/services/cleanup-service.js");
const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");

const DAY = 24 * 60 * 60 * 1000;
const oldStorage = CONFIG.storagePath;
const storage = mkdtempSync(join(tmpdir(), "omms-cleanup-count-"));

afterAll(async () => {
  await cleanupTursoTestDirectory(storage);
  CONFIG.storagePath = oldStorage;
});

describe("counting what a deletion would remove", () => {
  it("counts old unpinned memories only and deletes nothing", async () => {
    CONFIG.storagePath = storage;
    CONFIG.embeddingDimensions = 8;
    await closeTursoAndInvalidateCaches();

    const old = Date.now() - 40 * DAY;
    // Old memories in two projects, so the count must cover every shard of the space.
    const hashes = ["a1b2c3d4e5f60718", "b1b2c3d4e5f60718"];
    const shards = [];
    for (const hash of hashes) shards.push(await tursoShardManager.createShard("project", hash, 0));
    const vector = new Float32Array(8);
    vector[0] = 1;
    const ids: string[] = [];
    for (let i = 0; i < 17; i++) {
      const shard = shards[i % 2]!;
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const id = i < 12 ? `old-${i}` : i < 15 ? `pinned-${i}` : `linked-${i}`;
      ids.push(id);
      await tursoVectorSearch.insertVector(db, {
        id,
        content: id,
        vector,
        containerTag: `omms_project_${hashes[i % 2]}`,
        type: "discussion",
        createdAt: old,
        updatedAt: old,
      });
      if (id.startsWith("pinned-")) await tursoVectorSearch.pinMemory(db, id);
      if (id.startsWith("linked-")) {
        const promptId = await userPromptManager.savePrompt("s1", `m${i}`, "/work", "prompt");
        await userPromptManager.linkMemoryToPrompt(promptId, id);
      }
    }
    const prompts = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
    await prompts.run("UPDATE user_prompts SET created_at = ?", [old]);

    // 12 unlinked and 2 linked to old prompts; the 3 pinned ones stay out (ADR-051).
    expect(await new CleanupService().countCleanupCandidates(30)).toBe(14);

    const left: string[] = [];
    for (const shard of shards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const rows = await db.all("SELECT id FROM memories");
      left.push(...rows.map((row) => String(row.id)));
    }
    expect(left.sort()).toEqual([...ids].sort());
    expect(Number((await prompts.get("SELECT COUNT(*) AS n FROM user_prompts"))?.n)).toBe(2);
  });

  it("counts nothing when no memory is older than the days given", async () => {
    expect(await new CleanupService().countCleanupCandidates(60)).toBe(0);
  });
});
