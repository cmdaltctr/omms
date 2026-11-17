import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// A config file written by an older version: the old switch is on, the new key is absent.
// The isolated runner gives this process a scratch home, so this never touches the real config.
const configDir = join(homedir(), ".config", "omms");
const configFile = join(configDir, "omms.jsonc");
const OLD_FILE = '{\n  "autoCleanupEnabled": true,\n  "autoCleanupRetentionDays": 30\n}\n';
mkdirSync(configDir, { recursive: true });
writeFileSync(configFile, OLD_FILE);

const { CONFIG } = await import("../src/config.js");
const { CleanupService, cleanupService, startDailyMaintenanceTimer } =
  await import("../src/services/cleanup-service.js");
const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const attempts = await import("../src/services/capture-attempt-store.js");
const retries = await import("../src/services/capture-retry-queue.js");

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const oldStorage = CONFIG.storagePath;
let storage: string | undefined;

afterEach(async () => {
  await cleanupTursoTestDirectory(storage);
  storage = undefined;
});

afterAll(() => {
  CONFIG.storagePath = oldStorage;
});

/**
 * A store with three old unpinned memories, one old pinned memory, one recent memory,
 * one old memory linked to an old prompt, one old and one new prompt, one old and one new
 * capture attempt, and one old and one new capture retry row.
 */
async function seedStore() {
  storage = mkdtempSync(join(tmpdir(), "omms-cleanup-maintenance-"));
  CONFIG.storagePath = storage;
  CONFIG.embeddingDimensions = 8;
  CONFIG.autoCleanupRetentionDays = 30;
  CONFIG.captureAttemptRetentionDays = 30;
  CONFIG.captureRetryRetentionHours = 72;
  await closeTursoAndInvalidateCaches();

  const now = Date.now();
  const old = now - 40 * DAY;
  const scopeHash = "a1b2c3d4e5f60718";
  const shard = await tursoShardManager.createShard("project", scopeHash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  const vector = new Float32Array(8);
  vector[0] = 1;
  for (const [id, at] of [
    ["old-1", old],
    ["old-2", old],
    ["old-3", old],
    ["pinned-old", old],
    ["linked-old", old],
    ["fresh", now],
  ] as const) {
    await tursoVectorSearch.insertVector(db, {
      id,
      content: id,
      vector,
      containerTag: `omms_project_${scopeHash}`,
      type: "discussion",
      createdAt: at,
      updatedAt: at,
    });
  }
  await tursoVectorSearch.pinMemory(db, "pinned-old");

  const oldPrompt = await userPromptManager.savePrompt("s1", "m1", "/work", "old prompt");
  await userPromptManager.savePrompt("s1", "m2", "/work", "new prompt");
  await userPromptManager.linkMemoryToPrompt(oldPrompt, "linked-old");
  const prompts = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
  await prompts.run("UPDATE user_prompts SET created_at = ? WHERE id = ?", [old, oldPrompt]);

  await seedRecords(now);
  return { db, prompts };
}

async function seedRecords(now: number) {
  const record = {
    host: "pi" as const,
    sourceType: "live-capture" as const,
    sessionId: "s1",
    path: null,
    provider: null,
    model: null,
    stopReason: null,
    blockTypes: null,
    promptChars: null,
    replyChars: null,
    durationMs: 1,
    outcome: "saved" as const,
    reason: null,
  };
  await attempts.saveCaptureAttempt(record, now - 40 * DAY);
  await attempts.saveCaptureAttempt(record, now - DAY);

  const unit = (promptId: string) => ({
    host: "pi" as const,
    hostSessionId: "s1",
    sourceType: "live-capture" as const,
    projectDirectory: "/work",
    userPrompt: "prompt",
    promptId,
    textResponses: ["reply"],
    toolCalls: [],
  });
  const failure = { reason: "call-error" as const };
  await retries.enqueueCaptureRetry(unit(`old-${now}`), failure, CONFIG, now - 73 * HOUR);
  await retries.enqueueCaptureRetry(unit(`new-${now}`), failure, CONFIG, now - HOUR);
}

async function memoryIds(db: Awaited<ReturnType<typeof seedStore>>["db"]) {
  const rows = await db.all("SELECT id FROM memories ORDER BY id");
  return rows.map((row) => String(row.id));
}

async function promptCount(prompts: Awaited<ReturnType<typeof seedStore>>["prompts"]) {
  return Number((await prompts.get("SELECT COUNT(*) AS n FROM user_prompts"))?.n);
}

async function recordCounts(prompts: Awaited<ReturnType<typeof seedStore>>["prompts"]) {
  const a = await prompts.get("SELECT COUNT(*) AS n FROM capture_attempts");
  const r = await prompts.get("SELECT COUNT(*) AS n FROM capture_retry_queue");
  return { attempts: Number(a?.n), retries: Number(r?.n) };
}

const ALL_MEMORIES = ["fresh", "linked-old", "old-1", "old-2", "old-3", "pinned-old"];

describe("daily maintenance with deletion off", () => {
  it("deletes no memory and no prompt, and still prunes the record tables", async () => {
    const { db, prompts } = await seedStore();
    expect(await recordCounts(prompts)).toEqual({ attempts: 2, retries: 2 });

    await new CleanupService().runDailyMaintenance(false);

    expect(await memoryIds(db)).toEqual(ALL_MEMORIES);
    expect(await promptCount(prompts)).toBe(2);
    expect(await recordCounts(prompts)).toEqual({ attempts: 1, retries: 1 });
  });
});

describe("daily maintenance with deletion on", () => {
  it("deletes exactly the memories the count reports, and keeps pinned ones", async () => {
    const { db, prompts } = await seedStore();
    const service = new CleanupService();
    const counted = await service.countCleanupCandidates(30);
    expect(counted).toBe(4);

    await service.runDailyMaintenance(true);

    const left = await memoryIds(db);
    expect(ALL_MEMORIES.length - left.length).toBe(counted);
    // The memory linked to the old prompt goes in the same run as its prompt (ADR-051).
    expect(left).toEqual(["fresh", "pinned-old"]);
    expect(await promptCount(prompts)).toBe(1);
    expect(await recordCounts(prompts)).toEqual({ attempts: 1, retries: 1 });
    expect(await service.countCleanupCandidates(30)).toBe(0);
  });
});

describe("the once-a-day guard", () => {
  it("does nothing on a second call the same day", async () => {
    const { db, prompts } = await seedStore();
    const service = new CleanupService();
    await service.runDailyMaintenance(false);
    await seedRecords(Date.now());
    expect(await recordCounts(prompts)).toEqual({ attempts: 3, retries: 3 });

    await service.runDailyMaintenance(true);

    expect(await memoryIds(db)).toEqual(ALL_MEMORIES);
    expect(await promptCount(prompts)).toBe(2);
    expect(await recordCounts(prompts)).toEqual({ attempts: 3, retries: 3 });
  });
});

describe("the web app daily timer", () => {
  it("runs housekeeping and deletes no memory for a file with only the old switch", async () => {
    const { db, prompts } = await seedStore();
    // The config file still says "autoCleanupEnabled": true and has no autoDeleteOldMemories.
    expect(readFileSync(configFile, "utf8")).toBe(OLD_FILE);

    const stop = startDailyMaintenanceTimer();
    try {
      const deadline = Date.now() + 10_000;
      while ((await recordCounts(prompts)).attempts !== 1 && Date.now() < deadline) {
        await Bun.sleep(20);
      }
      while (cleanupService.getStatus().isRunning && Date.now() < deadline) {
        await Bun.sleep(20);
      }
    } finally {
      stop();
    }

    expect(await recordCounts(prompts)).toEqual({ attempts: 1, retries: 1 });
    expect(await memoryIds(db)).toEqual(ALL_MEMORIES);
    expect(await promptCount(prompts)).toBe(2);
    expect(readFileSync(configFile, "utf8")).toBe(OLD_FILE);
  });
});

describe("the manual Cleanup button", () => {
  it("keeps deleting old unpinned memories and prompts whatever the switches say", async () => {
    const { db, prompts } = await seedStore();

    const result = await new CleanupService().runCleanup();

    expect(result.deletedCount).toBe(4);
    expect(result.pinnedMemoriesSkipped).toBe(1);
    expect(await memoryIds(db)).toEqual(["fresh", "pinned-old"]);
    expect(await promptCount(prompts)).toBe(1);
    expect(await recordCounts(prompts)).toEqual({ attempts: 1, retries: 1 });
  });
});
