import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const storage = mkdtempSync(join(tmpdir(), "omms-retry-drain-"));
const config = {
  storagePath: storage,
  captureTrace: false,
  captureRetryRetentionHours: 72,
} as Record<string, unknown> & { storagePath: string; captureRetryRetentionHours: number };
const logged: Array<{ message: string; data: unknown }> = [];
const saved: Array<{
  promptId?: string;
  sourceEntryIds?: string[];
  host?: string;
  hostSessionId?: string;
  sourceType?: string;
}> = [];

mock.module("../src/config.js", () => ({ CONFIG: config, refreshConfigIfChanged: () => {} }));
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logged.push({ message, data }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "omms_project_test", displayName: "test" } }),
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async (_text: string, _tag: string, meta: (typeof saved)[number]) => {
      saved.push(meta);
      return { success: true, id: `mem-${saved.length}` };
    },
  },
}));
mock.module("../src/core/capture-context.js", () => ({
  buildMarkdownContext: () => "context",
  getAutoCaptureMarkdownBudget: () => 1000,
}));

const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const queue = await import("../src/services/capture-retry-queue.js");
const drain = await import("../src/services/capture-retry-drain.js");
const { CaptureAttemptError } = await import("../src/core/capture.js");
const { httpStatusError } = await import("../src/core/capture-retry-policy.js");
type CaptureWorkUnit = import("../src/core/capture.js").CaptureWorkUnit;
type CaptureSummaryProvider = import("../src/core/host.js").CaptureSummaryProvider;

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 28, 12);
const network = { reason: "call-error" as const };

afterAll(async () => {
  await tursoConnectionManager.closeAll();
  rmSync(storage, { recursive: true, force: true });
});

beforeEach(async () => {
  logged.length = 0;
  saved.length = 0;
  config.captureRetryRetentionHours = 72;
  await queue.pruneCaptureRetries({ ...config, captureRetryRetentionHours: 0 });
  drain.registerCaptureRetryDrain("pi", null);
  drain.registerCaptureRetryDrain("opencode", null);
});

function unit(promptId: string, host: "pi" | "opencode" = "pi"): CaptureWorkUnit {
  return {
    host,
    hostSessionId: "session-1",
    sourceType: "live-capture",
    projectDirectory: "/work/project",
    userPrompt: `prompt ${promptId}`,
    promptId,
    textResponses: ["reply"],
    toolCalls: [],
    sourceEntryIds: [promptId, `${promptId}-reply`],
  };
}

function provider(
  reply: (call: number) => { summary: string; type: string; tags: string[] } | Error
): CaptureSummaryProvider & { calls: number } {
  const fake = {
    calls: 0,
    async summarize() {
      fake.calls++;
      const value = reply(fake.calls);
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return fake;
}

const memory = { summary: "Fixed the bug", type: "bug-fix", tags: ["auth"] };

async function queued(...ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await queue.enqueueCaptureRetry(unit(id), network, config, T0 + i);
  }
}

async function rows() {
  const db = await tursoConnectionManager.getConnection(join(storage, "user-prompts.db"));
  return db.all("SELECT turn_id, attempts FROM capture_retry_queue ORDER BY id");
}

const later = () => T0 + HOUR;

describe("drainCaptureRetries", () => {
  it("saves due turns with their original provenance and deletes them", async () => {
    await queued("a", "b");
    const result = await drain.drainCaptureRetries({
      host: "pi",
      provider: provider(() => memory),
      config,
      now: later,
    });
    expect(result).toMatchObject({ status: "done", captured: 2, stopped: false });
    expect(saved.map((meta) => meta.promptId)).toEqual(["a", "b"]);
    // The fields a history import reads to skip a turn as `live-captured`.
    expect(saved[0]).toMatchObject({
      host: "pi",
      hostSessionId: "session-1",
      sourceType: "live-capture",
      promptId: "a",
      sourceEntryIds: ["a", "a-reply"],
    });
    expect(await rows()).toHaveLength(0);
  });

  it("deletes a turn the extractor skips", async () => {
    await queued("a");
    const settled: string[] = [];
    const result = await drain.drainCaptureRetries({
      host: "pi",
      provider: provider(() => ({ summary: "", type: "skip", tags: [] })),
      config,
      now: later,
      onSettled: async (u, r) => {
        settled.push(`${u.promptId}:${r.status}`);
      },
    });
    expect(result.skipped).toBe(1);
    expect(settled).toEqual(["a:skipped"]);
    expect(await rows()).toHaveLength(0);
  });

  it("stops at the first retryable failure and reschedules that turn", async () => {
    await queued("a", "b", "c", "d", "e");
    const fake = provider(() => new Error("ECONNREFUSED"));
    const result = await drain.drainCaptureRetries({
      host: "pi",
      provider: fake,
      config,
      now: later,
    });
    expect(result.stopped).toBe(true);
    expect(fake.calls).toBe(1);
    const remaining = await rows();
    expect(remaining).toHaveLength(5);
    expect(Number(remaining[0]!.attempts)).toBe(2);
    // The next try waits 5 minutes (second failed try), plus at most 20 %.
    expect(await queue.listDueCaptureRetries("pi", config, later() + 4 * 60_000)).toHaveLength(4);
  });

  it("deletes a turn that now fails for good and goes on", async () => {
    await queued("a", "b");
    const fake = provider((call) => (call === 1 ? httpStatusError("401", 401) : memory));
    const result = await drain.drainCaptureRetries({
      host: "pi",
      provider: fake,
      config,
      now: later,
    });
    expect(result).toMatchObject({ dropped: 1, captured: 1 });
    expect(await rows()).toHaveLength(0);
  });

  it("does not retry turns that are not due or belong to the other host", async () => {
    await queued("a");
    await queue.enqueueCaptureRetry(unit("o", "opencode"), network, config, T0);
    const fake = provider(() => memory);
    await drain.drainCaptureRetries({ host: "pi", provider: fake, config, now: () => T0 + 1000 });
    expect(fake.calls).toBe(0);
    await drain.drainCaptureRetries({ host: "pi", provider: fake, config, now: later });
    expect(fake.calls).toBe(1);
    expect((await rows()).map((row) => row.turn_id)).toEqual(["o"]);
  });

  it("deletes an expired turn without retrying it", async () => {
    await queued("a");
    const fake = provider(() => memory);
    await drain.drainCaptureRetries({
      host: "pi",
      provider: fake,
      config,
      now: () => T0 + 72 * HOUR + 60_000,
    });
    expect(fake.calls).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("writes one capture attempt record per retry", async () => {
    await queued("a");
    await drain.drainCaptureRetries({
      host: "pi",
      provider: provider(() => memory),
      config,
      now: later,
    });
    expect(logged.filter((entry) => entry.message === "Capture attempt")).toHaveLength(1);
  });

  it("runs one pass per host at a time", async () => {
    await queued("a");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: CaptureSummaryProvider = {
      async summarize() {
        await gate;
        return memory;
      },
    };
    const first = drain.drainCaptureRetries({ host: "pi", provider: slow, config, now: later });
    const second = await drain.drainCaptureRetries({
      host: "pi",
      provider: slow,
      config,
      now: later,
    });
    expect(second.status).toBe("running");
    release();
    expect((await first).captured).toBe(1);
  });

  it("with retention 0 deletes every turn and retries none", async () => {
    await queued("a", "b");
    config.captureRetryRetentionHours = 0;
    const fake = provider(() => memory);
    const result = await drain.drainCaptureRetries({
      host: "pi",
      provider: fake,
      config,
      now: later,
    });
    expect(result.status).toBe("off");
    expect(fake.calls).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("logs a code when the queue fails and does not throw", async () => {
    const broken = { ...config, storagePath: join(tmpdir(), "outside-storage") };
    const result = await drain.drainCaptureRetries({
      host: "pi",
      provider: provider(() => memory),
      config: broken,
      now: later,
    });
    expect(result.status).toBe("error");
    expect(logged.some((entry) => entry.message === "Capture retry pass failed")).toBe(true);
  });
});

describe("queueFailedCapture", () => {
  const failed = (reason: "call-error" | "invalid-json", httpStatus?: number) =>
    new CaptureAttemptError(new Error("boom"), { reason, httpStatus });

  it("queues a retryable failure", async () => {
    expect(await drain.queueFailedCapture(unit("a"), failed("call-error"), config)).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  it("does not queue a bad key, a bad reply, or anything while the queue is off", async () => {
    expect(await drain.queueFailedCapture(unit("a"), failed("call-error", 401), config)).toBe(
      false
    );
    expect(await drain.queueFailedCapture(unit("b"), failed("invalid-json"), config)).toBe(false);
    const off = { ...config, captureRetryRetentionHours: 0 };
    expect(await drain.queueFailedCapture(unit("c"), failed("call-error"), off)).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it("returns false and logs a code when the queue cannot be written", async () => {
    const broken = { ...config, storagePath: join(tmpdir(), "outside-storage") };
    expect(await drain.queueFailedCapture(unit("a"), failed("call-error"), broken)).toBe(false);
    expect(logged.some((entry) => entry.message === "Capture retry queue write failed")).toBe(true);
  });
});

describe("requestCaptureRetryNow", () => {
  it("returns scheduled and makes turns due when the host is not in this process", async () => {
    await queue.enqueueCaptureRetry(unit("o", "opencode"), network, config, Date.now());
    expect(await drain.requestCaptureRetryNow("opencode", config)).toBe("scheduled");
    expect(await queue.listDueCaptureRetries("opencode", config)).toHaveLength(1);
  });

  it("starts the registered drain", async () => {
    let started = 0;
    drain.registerCaptureRetryDrain("pi", async () => {
      started++;
      return { status: "done", captured: 0, skipped: 0, dropped: 0, stopped: false };
    });
    expect(await drain.requestCaptureRetryNow("pi", config)).toBe("started");
    expect(started).toBe(1);
  });

  it("returns running while a pass for that host is running", async () => {
    await queued("a");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    drain.registerCaptureRetryDrain("pi", async () => ({
      status: "done",
      captured: 0,
      skipped: 0,
      dropped: 0,
      stopped: false,
    }));
    const pass = drain.drainCaptureRetries({
      host: "pi",
      provider: {
        async summarize() {
          await gate;
          return memory;
        },
      },
      config,
      now: later,
    });
    // Let the pass claim its row before asking.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await drain.requestCaptureRetryNow("pi", config)).toBe("running");
    release();
    await pass;
  });
});
