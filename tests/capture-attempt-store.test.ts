import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import {
  emitCaptureAttempt,
  type CaptureAttemptRecord,
} from "../src/services/capture-diagnostics.js";
import {
  saveCaptureAttempt,
  queryCaptureAttempts,
  pruneCaptureAttempts,
} from "../src/services/capture-attempt-store.js";

const storage = mkdtempSync(join(tmpdir(), "omms-attempts-"));
const oldStorage = CONFIG.storagePath;
CONFIG.storagePath = storage;
afterAll(async () => {
  await tursoConnectionManager.closeAll();
  CONFIG.storagePath = oldStorage;
  rmSync(storage, { recursive: true, force: true });
});

const attempt = (
  outcome: "saved" | "skipped" | "failed",
  reason: string | null = null
): CaptureAttemptRecord => ({
  host: "pi",
  sourceType: "live-capture",
  sessionId: "session",
  path: "pi",
  provider: "zai",
  model: "glm",
  stopReason: "stop",
  blockTypes: ["text"],
  promptChars: 10,
  replyChars: 20,
  durationMs: 30,
  outcome,
  reason: reason as CaptureAttemptRecord["reason"],
});
describe("capture attempt store", () => {
  it("saves metadata for all outcomes without text columns", async () => {
    const now = Date.UTC(2026, 0, 10);
    await saveCaptureAttempt(attempt("saved"), now);
    await saveCaptureAttempt(attempt("skipped"), now + 1);
    await saveCaptureAttempt(attempt("failed", "call-error"), now + 2);
    const db = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
    const columns = await db.all("PRAGMA table_info(capture_attempts)");
    expect(columns.map((row) => row.name)).not.toContain("prompt");
    expect(columns.map((row) => row.name)).not.toContain("reply");
    const summary = await queryCaptureAttempts(now, now + 100);
    expect(summary.recent).toHaveLength(3);
    expect(summary.byModel[0]).toMatchObject({
      host: "pi",
      provider: "zai",
      model: "glm",
      saved: 1,
      skipped: 1,
      failed: 1,
    });
    expect(summary.byReason).toEqual([expect.objectContaining({ reason: "call-error", count: 1 })]);
  });

  it("keeps the outcome and log when storing an attempt fails", async () => {
    const previousLog = process.env.OMMS_LOG_FILE;
    const failedPath = join(storage, "not-a-directory");
    writeFileSync(failedPath, "file");
    CONFIG.storagePath = failedPath;
    process.env.OMMS_LOG_FILE = join(storage, "attempts.log");
    try {
      expect(() =>
        emitCaptureAttempt(attempt("failed", "call-error"), {}, { captureTrace: false })
      ).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(process.env.OMMS_LOG_FILE, "utf8")).toContain("Capture attempt");
    } finally {
      CONFIG.storagePath = storage;
      if (previousLog === undefined) delete process.env.OMMS_LOG_FILE;
      else process.env.OMMS_LOG_FILE = previousLog;
    }
  });

  it("removes rows older than retention", async () => {
    await pruneCaptureAttempts(1, Date.UTC(2026, 0, 12));
    const summary = await queryCaptureAttempts(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 13));
    expect(summary.recent).toHaveLength(0);
  });
});
