import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logged: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logged.push({ message, data }),
}));

const {
  buildCaptureAttemptRecord,
  emitCaptureAttempt,
  getTraceDirectory,
  pruneTraces,
  redactTraceText,
  resetTraceStateForTests,
} = await import("../src/services/capture-diagnostics.js");

const RECORD_KEYS = [
  "blockTypes",
  "durationMs",
  "host",
  "model",
  "outcome",
  "path",
  "promptChars",
  "provider",
  "reason",
  "replyChars",
  "sessionId",
  "sourceType",
  "stopReason",
].sort();

const context = { host: "pi" as const, sourceType: "live-capture" as const, sessionId: "s1" };
const fakeKey = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";

let logDir: string;
let previousLogFile: string | undefined;

beforeEach(() => {
  logged.length = 0;
  resetTraceStateForTests();
  logDir = mkdtempSync(join(tmpdir(), "omms-diag-"));
  previousLogFile = process.env.OMMS_LOG_FILE;
  process.env.OMMS_LOG_FILE = join(logDir, "omms.log");
});

afterEach(() => {
  if (previousLogFile === undefined) delete process.env.OMMS_LOG_FILE;
  else process.env.OMMS_LOG_FILE = previousLogFile;
  rmSync(logDir, { recursive: true, force: true });
});

describe("capture attempt record", () => {
  it("has the same keys whatever the path could observe", () => {
    const full = buildCaptureAttemptRecord(
      context,
      {
        path: "host-model",
        provider: "zai",
        model: "glm-5.3",
        stopReason: "stop",
        blockTypes: ["thinking", "text"],
        systemPrompt: "sys",
        userPrompt: "user",
        rawReply: "{}",
        failureReason: "schema-mismatch",
      },
      "failed",
      12
    );
    const empty = buildCaptureAttemptRecord(context, {}, "failed", 3);
    expect(Object.keys(full).sort()).toEqual(RECORD_KEYS);
    expect(Object.keys(empty).sort()).toEqual(RECORD_KEYS);
    expect(full).toMatchObject({ promptChars: 7, replyChars: 2, reason: "schema-mismatch" });
    expect(empty).toMatchObject({ provider: null, promptChars: null, reason: "call-error" });
  });

  it("carries no reason unless the attempt failed", () => {
    const record = buildCaptureAttemptRecord(context, { failureReason: "empty-text" }, "saved", 1);
    expect(record.reason).toBeNull();
  });

  it("logs metadata only, never prompt or reply text", () => {
    const diagnostics = {
      provider: "zai",
      model: "glm-5.3",
      userPrompt: `please remember ${fakeKey}`,
      rawReply: `reply with ${fakeKey} and more words`,
      failureReason: "invalid-json" as const,
    };
    const record = buildCaptureAttemptRecord(context, diagnostics, "failed", 5);
    emitCaptureAttempt(record, diagnostics, {});
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe("Capture attempt");
    const text = JSON.stringify(logged);
    expect(text).not.toContain(fakeKey);
    expect(text).not.toContain("please remember");
    expect(text).not.toContain("more words");
  });
});

describe("trace redaction", () => {
  it("removes private regions", () => {
    expect(redactTraceText("a <private>my password</private> b", {})).toBe("a [REDACTED] b");
  });

  it("removes each known key format", () => {
    const samples = [
      "sk-ant-api03-abcdefghijklmnop",
      fakeKey,
      "github_pat_11ABCDEFG0123456789abcdef",
      "ghp_abcdefghijklmnopqrstuvwxyz0123",
      "AKIAABCDEFGHIJKLMNOP",
      "xoxb-1234567890-abcdefghij",
      `AIza${"a".repeat(35)}`,
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
    ];
    for (const sample of samples) {
      expect(redactTraceText(`before ${sample} after`, {})).toBe("before [REDACTED] after");
    }
    expect(redactTraceText("Authorization: Bearer abcdefghijklmnop1234", {})).toBe(
      "Authorization: Bearer [REDACTED]"
    );
  });

  it("removes configured secret values but not unresolved references", () => {
    const config = { memoryApiKey: "plain-custom-secret", embeddingApiKey: "env://EMBED_KEY" };
    expect(redactTraceText("key=plain-custom-secret env://EMBED_KEY", config)).toBe(
      "key=[REDACTED] env://EMBED_KEY"
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Edited src/core/capture.ts and ran bun test; the task-list was skipped.";
    expect(redactTraceText(text, { memoryApiKey: "short" })).toBe(text);
  });
});

describe("trace files", () => {
  const diagnostics = {
    provider: "zai",
    model: "glm-5.3",
    systemPrompt: "system",
    userPrompt: "a <private>hidden</private> prompt",
    rawReply: `reply ${fakeKey}`,
  };

  it("writes nothing when tracing is off", () => {
    const record = buildCaptureAttemptRecord(context, diagnostics, "saved", 1);
    emitCaptureAttempt(record, diagnostics, {});
    expect(existsSync(getTraceDirectory())).toBe(false);
  });

  it("appends one redacted JSON line per attempt with private permissions", () => {
    const now = new Date(2026, 8, 27, 12);
    const record = buildCaptureAttemptRecord(context, diagnostics, "saved", 1);
    emitCaptureAttempt(record, diagnostics, { captureTrace: true }, now);
    emitCaptureAttempt(record, diagnostics, { captureTrace: true }, now);

    const dir = getTraceDirectory();
    const file = join(dir, "capture-2026-09-27.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry).toMatchObject({
      schemaVersion: 1,
      outcome: "saved",
      systemPrompt: "system",
      userPrompt: "a [REDACTED] prompt",
      reply: "reply [REDACTED]",
    });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps the outcome and logs without content when the trace cannot be written", () => {
    // A plain file where the traces directory should be makes every write fail.
    writeFileSync(getTraceDirectory(), "not a directory");
    const record = buildCaptureAttemptRecord(context, diagnostics, "saved", 1);
    expect(() =>
      emitCaptureAttempt(record, diagnostics, { captureTrace: true }, new Date(2026, 8, 27))
    ).not.toThrow();
    const failure = logged.find((entry) => entry.message === "Capture trace write failed");
    expect(failure).toBeDefined();
    expect(JSON.stringify(logged)).not.toContain("hidden");
    expect(JSON.stringify(logged)).not.toContain(fakeKey);
  });
});

describe("trace retention", () => {
  it("deletes only trace files older than the limit", () => {
    const dir = getTraceDirectory();
    mkdirSync(dir, { recursive: true });
    const names = [
      "capture-2026-09-01.jsonl",
      "capture-2026-09-19.jsonl",
      "capture-2026-09-20.jsonl",
      "capture-2026-09-27.jsonl",
      "notes-2020-01-01.jsonl",
      "capture-2020-01-01.txt",
    ];
    for (const name of names) writeFileSync(join(dir, name), "{}\n");

    const removed = pruneTraces({ captureTraceRetentionDays: 7 }, new Date(2026, 8, 27, 9));
    expect(removed).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(
      [
        "capture-2020-01-01.txt",
        "capture-2026-09-20.jsonl",
        "capture-2026-09-27.jsonl",
        "notes-2020-01-01.jsonl",
      ].sort()
    );
  });

  it("does nothing when there is no traces directory", () => {
    expect(pruneTraces({}, new Date())).toBe(0);
  });
});
