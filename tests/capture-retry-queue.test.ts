import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logged: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logged.push({ message, data }),
}));

const { CONFIG } = await import("../src/config.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const queue = await import("../src/services/capture-retry-queue.js");
type CaptureWorkUnit = import("../src/core/capture.js").CaptureWorkUnit;

const storage = mkdtempSync(join(tmpdir(), "omms-retry-queue-"));
const oldStorage = CONFIG.storagePath;
CONFIG.storagePath = storage;
const config = { storagePath: storage, captureRetryRetentionHours: 72 };
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 28, 12);
const network = { reason: "call-error" as const };

afterAll(async () => {
  await tursoConnectionManager.closeAll();
  CONFIG.storagePath = oldStorage;
  rmSync(storage, { recursive: true, force: true });
});

beforeEach(async () => {
  logged.length = 0;
  await queue.pruneCaptureRetries({ ...config, captureRetryRetentionHours: 0 });
});

function unit(overrides: Partial<CaptureWorkUnit> = {}): CaptureWorkUnit {
  return {
    host: "pi",
    hostSessionId: "session-1",
    sourceType: "live-capture",
    projectDirectory: "/work/project",
    userPrompt: "Fix the login bug",
    promptId: "turn-1",
    textResponses: ["I changed the session check."],
    toolCalls: [{ name: "edit", input: "src/login.ts" }],
    sourceEntryIds: ["turn-1", "reply-1"],
    ...overrides,
  };
}

async function rawRows() {
  const db = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
  return db.all("SELECT * FROM capture_retry_queue ORDER BY id");
}

describe("capture retry queue store", () => {
  it("queues a turn and updates the same row when the turn is queued again", async () => {
    expect(await queue.enqueueCaptureRetry(unit(), network, config, T0)).toBe("queued");
    expect(await queue.enqueueCaptureRetry(unit(), network, config, T0 + 1000)).toBe("queued");
    const rows = await rawRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.attempts)).toBe(2);
    expect(Number(rows[0]!.created_at)).toBe(T0);
    expect(await queue.countCaptureRetries(config)).toEqual({ opencode: 0, pi: 1 });
  });

  it("lists only this host's due rows, oldest first", async () => {
    await queue.enqueueCaptureRetry(unit({ promptId: "b" }), network, config, T0 + 10);
    await queue.enqueueCaptureRetry(unit({ promptId: "a" }), network, config, T0);
    await queue.enqueueCaptureRetry(unit({ host: "opencode", promptId: "c" }), network, config, T0);
    expect(await queue.listDueCaptureRetries("pi", config, T0 + 30_000)).toHaveLength(0);
    const due = await queue.listDueCaptureRetries("pi", config, T0 + 2 * 60_000);
    expect(due.map((row) => row.turnId)).toEqual(["a", "b"]);
    expect(due[0]!.workUnit.userPrompt).toBe("Fix the login bug");
  });

  it("reschedules with the wait schedule and deletes a row", async () => {
    await queue.enqueueCaptureRetry(unit(), network, config, T0);
    const [row] = await queue.listDueCaptureRetries("pi", config, T0 + HOUR);
    await queue.rescheduleCaptureRetry(row!, network, config, T0 + HOUR);
    // Second failed try: 5 minutes, plus at most 20 %.
    expect(await queue.listDueCaptureRetries("pi", config, T0 + HOUR + 4 * 60_000)).toHaveLength(0);
    expect(await queue.listDueCaptureRetries("pi", config, T0 + HOUR + 6 * 60_000)).toHaveLength(1);
    await queue.deleteCaptureRetry(row!.id, config);
    expect(await rawRows()).toHaveLength(0);
  });

  it("keeps a Retry-After wait", async () => {
    await queue.enqueueCaptureRetry(
      unit(),
      { reason: "call-error", httpStatus: 429, retryAfterMs: HOUR },
      config,
      T0
    );
    expect(await queue.listDueCaptureRetries("pi", config, T0 + HOUR - 1)).toHaveLength(0);
    expect(await queue.listDueCaptureRetries("pi", config, T0 + HOUR)).toHaveLength(1);
  });

  it("makes every row of one host due now", async () => {
    await queue.enqueueCaptureRetry(unit(), network, config, T0);
    await queue.enqueueCaptureRetry(unit({ host: "opencode" }), network, config, T0);
    expect(await queue.makeCaptureRetriesDue("pi", config, T0 + 1)).toBe(1);
    expect(await queue.listDueCaptureRetries("pi", config, T0 + 1)).toHaveLength(1);
    expect(await queue.listDueCaptureRetries("opencode", config, T0 + 1)).toHaveLength(0);
  });

  it("prunes rows older than the retention", async () => {
    await queue.enqueueCaptureRetry(unit(), network, config, T0);
    expect(await queue.pruneCaptureRetries(config, T0 + 72 * HOUR)).toBe(0);
    expect(await queue.pruneCaptureRetries(config, T0 + 72 * HOUR + 60_000)).toBe(1);
    expect(await rawRows()).toHaveLength(0);
  });

  it("queues nothing and prunes every row when retention is 0", async () => {
    await queue.enqueueCaptureRetry(unit(), network, config, T0);
    const off = { ...config, captureRetryRetentionHours: 0 };
    expect(await queue.enqueueCaptureRetry(unit({ promptId: "x" }), network, off, T0)).toBe("off");
    expect(await queue.pruneCaptureRetries(off, T0)).toBe(1);
    expect(await rawRows()).toHaveLength(0);
  });
});

describe("cleaning and size limits", () => {
  const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

  it("stores no private text and no key", async () => {
    await queue.enqueueCaptureRetry(
      unit({
        userPrompt: "Deploy it <private>my home address</private>",
        textResponses: ["Done. <private>secret plan</private>"],
        toolCalls: [{ name: "bash", input: `export ANTHROPIC_API_KEY=${key}` }],
      }),
      network,
      config,
      T0
    );
    const [row] = await rawRows();
    const stored = String(row!.work_unit);
    expect(stored).not.toContain("my home address");
    expect(stored).not.toContain("secret plan");
    expect(stored).not.toContain(key);
    expect(stored).toContain("Deploy it");
  });

  it("does not queue a fully private turn", async () => {
    const result = await queue.enqueueCaptureRetry(
      unit({
        userPrompt: "<private>all of it</private>",
        textResponses: ["<private>reply</private>"],
        toolCalls: [],
      }),
      network,
      config,
      T0
    );
    expect(result).toBe("private");
    expect(await rawRows()).toHaveLength(0);
  });

  it("does not queue a turn over 256 KB and logs only its size and session", async () => {
    const big = "x".repeat(300 * 1024);
    const result = await queue.enqueueCaptureRetry(
      unit({ textResponses: [big] }),
      network,
      config,
      T0
    );
    expect(result).toBe("too-large");
    expect(await rawRows()).toHaveLength(0);
    const entry = logged.find((e) => e.message.includes("too large"));
    expect(entry?.data).toEqual({ sessionID: "session-1", size: expect.any(Number) });
    expect(JSON.stringify(logged)).not.toContain("xxxx");
  });

  it("deletes the oldest rows to stay under 20 MB", async () => {
    const chunk = "y".repeat(200 * 1024);
    // 110 rows of about 200 KB each pass 20 MB.
    for (let i = 0; i < 110; i++) {
      await queue.enqueueCaptureRetry(
        unit({ promptId: `turn-${i}`, textResponses: [chunk] }),
        network,
        config,
        T0 + i
      );
    }
    const rows = await rawRows();
    const total = rows.reduce((sum, row) => sum + Number(row.size_bytes), 0);
    expect(total).toBeLessThanOrEqual(queue.MAX_QUEUE_BYTES);
    const turns = rows.map((row) => String(row.turn_id));
    expect(turns).not.toContain("turn-0");
    expect(turns).toContain("turn-109");
  });
});

describe("claims", () => {
  it("lets only one of two concurrent claims win", async () => {
    await queue.enqueueCaptureRetry(unit(), network, config, T0);
    const [row] = await queue.listDueCaptureRetries("pi", config, T0 + HOUR);
    const results = await Promise.all([
      queue.claimCaptureRetry(row!.id, config, T0 + HOUR),
      queue.claimCaptureRetry(row!.id, config, T0 + HOUR),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("lets an expired lease be claimed again", async () => {
    await queue.enqueueCaptureRetry(unit(), network, config, T0);
    const [row] = await queue.listDueCaptureRetries("pi", config, T0 + HOUR);
    expect(await queue.claimCaptureRetry(row!.id, config, T0 + HOUR)).toBe(true);
    expect(await queue.claimCaptureRetry(row!.id, config, T0 + HOUR + 60_000)).toBe(false);
    expect(await queue.claimCaptureRetry(row!.id, config, T0 + HOUR + 6 * 60_000)).toBe(true);
  });
});
