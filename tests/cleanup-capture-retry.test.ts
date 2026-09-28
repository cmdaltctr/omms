import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "omms-cleanup-retry-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = home;
process.env.USERPROFILE = home;

const { CONFIG } = await import("../src/config.js");
const storage = join(home, "data");
const oldStorage = CONFIG.storagePath;
CONFIG.storagePath = storage;

const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { CleanupService } = await import("../src/services/cleanup-service.js");
const queue = await import("../src/services/capture-retry-queue.js");

afterAll(async () => {
  await tursoConnectionManager.closeAll();
  CONFIG.storagePath = oldStorage;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  rmSync(home, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;

function unit(promptId: string) {
  return {
    host: "pi" as const,
    hostSessionId: "session-1",
    sourceType: "live-capture" as const,
    projectDirectory: "/work/project",
    userPrompt: "prompt",
    promptId,
    textResponses: ["reply"],
    toolCalls: [],
  };
}

async function turnIds() {
  const db = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
  const rows = await db.all("SELECT turn_id FROM capture_retry_queue ORDER BY id");
  return rows.map((row) => String(row.turn_id));
}

describe("cleanup run and the capture retry queue", () => {
  it("deletes queued turns older than the retention", async () => {
    CONFIG.captureRetryRetentionHours = 72;
    const now = Date.now();
    const failure = { reason: "call-error" as const };
    await queue.enqueueCaptureRetry(unit("old"), failure, CONFIG, now - 73 * HOUR);
    await queue.enqueueCaptureRetry(unit("new"), failure, CONFIG, now - HOUR);

    await new CleanupService().runCleanup();

    expect(await turnIds()).toEqual(["new"]);
  });

  it("deletes every queued turn while retention is 0", async () => {
    CONFIG.captureRetryRetentionHours = 0;
    await new CleanupService().runCleanup();
    expect(await turnIds()).toEqual([]);
    CONFIG.captureRetryRetentionHours = 72;
  });
});
