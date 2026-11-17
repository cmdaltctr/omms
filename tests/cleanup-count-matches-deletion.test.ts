import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// The confirm dialog shows `countCleanupCandidates`. This file checks that the number equals
// the memories that are gone once deletion has run until it deletes nothing more.
const { CONFIG } = await import("../src/config.js");
const { CleanupService } = await import("../src/services/cleanup-service.js");
const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");

const DAY = 24 * 60 * 60 * 1000;
const oldStorage = CONFIG.storagePath;
const storages: string[] = [];

afterAll(async () => {
  for (const storage of storages) await cleanupTursoTestDirectory(storage);
  CONFIG.storagePath = oldStorage;
});

const MUST_STAY = ["fresh", "fresh-linked", "memorisation-old", "pinned-old"];

async function seed() {
  const storage = mkdtempSync(join(tmpdir(), "omms-cleanup-count-matches-"));
  storages.push(storage);
  CONFIG.storagePath = storage;
  CONFIG.embeddingDimensions = 8;
  CONFIG.autoCleanupRetentionDays = 30;
  await closeTursoAndInvalidateCaches();

  const now = Date.now();
  const old = now - 40 * DAY;
  const hashes = ["a1b2c3d4e5f60718", "b1b2c3d4e5f60718"];
  const vector = new Float32Array(8);
  vector[0] = 1;
  const rows: [string, number, string][] = [
    ["unlinked-old-1", old, "discussion"],
    ["unlinked-old-2", old, "discussion"],
    ["linked-old-prompt-1", old, "discussion"],
    ["linked-old-prompt-2", old, "discussion"],
    ["linked-recent-prompt", old, "discussion"],
    ["pinned-old", old, "discussion"],
    ["memorisation-old", old, "memorisation"],
    ["fresh", now, "discussion"],
    ["fresh-linked", now, "discussion"],
  ];
  const dbs = [];
  for (const hash of hashes) {
    const shard = await tursoShardManager.createShard("project", hash, 0);
    dbs.push(await tursoConnectionManager.getConnection(shard.dbPath));
  }
  for (const [index, [id, at, type]] of rows.entries()) {
    const shardAt = index % 2;
    await tursoVectorSearch.insertVector(dbs[shardAt]!, {
      id,
      content: id,
      vector,
      containerTag: `omms_project_${hashes[shardAt]}`,
      type,
      createdAt: at,
      updatedAt: at,
    });
  }
  const pinnedAt = rows.findIndex(([id]) => id === "pinned-old") % 2;
  await tursoVectorSearch.pinMemory(dbs[pinnedAt]!, "pinned-old");

  const prompts = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
  const link = async (memoryId: string, createdAt: number) => {
    const promptId = await userPromptManager.savePrompt("s1", `m-${memoryId}`, "/work", memoryId);
    await userPromptManager.linkMemoryToPrompt(promptId, memoryId);
    await prompts.run("UPDATE user_prompts SET created_at = ? WHERE id = ?", [createdAt, promptId]);
  };
  await link("linked-old-prompt-1", old);
  await link("linked-old-prompt-2", old);
  await link("linked-recent-prompt", now);
  await link("fresh-linked", now);
  return { dbs, prompts };
}

async function memoryIds(dbs: Awaited<ReturnType<typeof seed>>["dbs"]): Promise<string[]> {
  const ids: string[] = [];
  for (const db of dbs) {
    const rows = await db.all("SELECT id FROM memories");
    ids.push(...rows.map((row) => String(row.id)));
  }
  return ids.sort();
}

describe("the cleanup count and the deletion agree", () => {
  it("one run deletes exactly the counted memories, and the rest stay", async () => {
    const { dbs, prompts } = await seed();
    const before = await memoryIds(dbs);
    const counted = await new CleanupService().countCleanupCandidates(30);

    // Run deletion until it removes nothing more, each run as a new process would.
    const afterFirst = await (async () => {
      await new CleanupService().runDailyMaintenance(true);
      return memoryIds(dbs);
    })();
    let left = afterFirst;
    for (let run = 0; run < 3; run++) {
      await new CleanupService().runDailyMaintenance(true);
      left = await memoryIds(dbs);
    }

    expect(counted).toBe(5);
    expect(before.length - left.length).toBe(counted);
    // Nothing waits for a later run: the first run already removed every counted memory.
    expect(afterFirst).toEqual(left);
    expect(left).toEqual(MUST_STAY);
    // The old prompts go in the same run; the recent ones stay.
    const kept = await prompts.all("SELECT content FROM user_prompts ORDER BY content");
    expect(kept.map((row) => String(row.content))).toEqual([
      "fresh-linked",
      "linked-recent-prompt",
    ]);
    expect(await new CleanupService().countCleanupCandidates(30)).toBe(0);
  });

  it("the manual Cleanup button removes the counted memories in one press", async () => {
    const { dbs } = await seed();
    const counted = await new CleanupService().countCleanupCandidates(30);

    const result = await new CleanupService().runCleanup();

    expect(result.deletedCount).toBe(counted);
    expect(result.linkedMemoriesDeleted).toBe(2);
    expect(await memoryIds(dbs)).toEqual(MUST_STAY);
  });
});
