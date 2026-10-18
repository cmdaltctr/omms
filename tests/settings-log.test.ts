import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guessLevel, readSettingsLog } from "../src/services/settings-log.js";

const dir = mkdtempSync(join(tmpdir(), "omms-log-"));
const prior = process.env.OMMS_LOG_FILE;
process.env.OMMS_LOG_FILE = join(dir, "omms.log");
afterEach(() => rmSync(process.env.OMMS_LOG_FILE!, { force: true }));

const T = "2026-10-18T18:36:51.802+01:00";

function write(...lines: string[]) {
  writeFileSync(process.env.OMMS_LOG_FILE!, lines.join("\n") + "\n");
}

describe("settings log", () => {
  it("returns no records when no log has been written", async () => {
    const result = await readSettingsLog();
    expect(result.records).toEqual([]);
    expect(result.path).toBe(process.env.OMMS_LOG_FILE!);
  });

  it("parses new-format lines into level, message and data", async () => {
    write(
      `[${T}] INFO Capture attempt: {"host":"pi"}`,
      `[${T}] WARN OpenCode host fetch unavailable; falling back to global fetch`,
      `[${T}] ERROR addMemory: error: {"error":"API embedding failed: 500"}`
    );
    const { records } = await readSettingsLog();
    expect(records).toEqual([
      {
        seq: 0,
        time: T,
        level: "info",
        guessed: false,
        message: "Capture attempt",
        data: '{"host":"pi"}',
      },
      {
        seq: 1,
        time: T,
        level: "warn",
        guessed: false,
        message: "OpenCode host fetch unavailable; falling back to global fetch",
        data: null,
      },
      {
        seq: 2,
        time: T,
        level: "error",
        guessed: false,
        message: "addMemory: error",
        data: '{"error":"API embedding failed: 500"}',
      },
    ]);
  });

  it("guesses the level of a legacy line from its message and marks it guessed", async () => {
    write(`[${T}] Failed to initialize embedding model: {"error":"..."}`);
    const { records } = await readSettingsLog();
    expect(records[0]).toMatchObject({ level: "error", guessed: true });
    expect(records[0]!.message).toBe("Failed to initialize embedding model");
  });

  it("reads a legacy line whose data mentions an error as info", async () => {
    write(`[${T}] Capture attempt: {"error":null}`);
    const { records } = await readSettingsLog();
    expect(records[0]).toMatchObject({ level: "info", guessed: true });
  });

  it("returns a session marker as an info record that is not guessed", async () => {
    write(`--- Session started: ${T} ---`);
    const { records } = await readSettingsLog();
    expect(records).toEqual([
      { seq: 0, time: T, level: "info", guessed: false, message: "Session started", data: null },
    ]);
  });

  it("joins a line that does not start a record onto the record before it", async () => {
    write(`[${T}] ERROR Something broke`, "  at somewhere", `[${T}] INFO Next`);
    const { records } = await readSettingsLog();
    expect(records.map((r) => r.message)).toEqual(["Something broke\n  at somewhere", "Next"]);
  });

  it("filters capture attempts and limits the number of records", async () => {
    write(
      `[${T}] INFO header`,
      `[${T}] INFO Capture attempt: {"outcome":"saved"}`,
      `[${T}] INFO other`,
      `[${T}] INFO Capture attempt: {"outcome":"failed"}`
    );
    const captures = await readSettingsLog({ lines: 1, filter: "capture" });
    expect(captures.records.map((r) => r.data)).toEqual(['{"outcome":"failed"}']);
    const last = await readSettingsLog({ lines: 2 });
    expect(last.records.map((r) => r.message)).toEqual(["other", "Capture attempt"]);
  });

  it("shows warn and error for the warn level, and error only for the error level", async () => {
    write(`[${T}] INFO a`, `[${T}] WARN b`, `[${T}] ERROR c`);
    expect((await readSettingsLog({ level: "warn" })).records.map((r) => r.message)).toEqual([
      "b",
      "c",
    ]);
    expect((await readSettingsLog({ level: "error" })).records.map((r) => r.message)).toEqual([
      "c",
    ]);
    expect((await readSettingsLog({ level: "bogus" })).records).toHaveLength(3);
  });

  it("combines the level filter with the capture filter", async () => {
    write(
      `[${T}] ERROR Capture attempt: {"outcome":"failed"}`,
      `[${T}] INFO Capture attempt: {"outcome":"saved"}`,
      `[${T}] ERROR other`
    );
    const { records } = await readSettingsLog({ level: "error", filter: "capture" });
    expect(records.map((r) => r.data)).toEqual(['{"outcome":"failed"}']);
  });

  it("applies the record limit after filtering", async () => {
    const lines = [`[${T}] ERROR first error`];
    for (let i = 0; i < 300; i++) lines.push(`[${T}] INFO routine ${i}`);
    lines.push(`[${T}] ERROR last error`);
    write(...lines);
    const { records } = await readSettingsLog({ lines: 200, level: "error" });
    expect(records.map((r) => r.message)).toEqual(["first error", "last error"]);
  });

  it("reads no more than the last 256 KB", async () => {
    writeFileSync(
      process.env.OMMS_LOG_FILE!,
      `secret\n${"x".repeat(300_000)}\n[${T}] INFO Capture attempt saved\n`
    );
    const result = await readSettingsLog();
    expect(result.records.map((r) => r.message)).toEqual(["Capture attempt saved"]);
  });
});

describe("guessLevel", () => {
  it("reads failure words as error and fallback words as warn, ignoring case", () => {
    expect(guessLevel("addMemory: ERROR")).toBe("error");
    expect(guessLevel("Unhandled Exception")).toBe("error");
    expect(guessLevel("Falling back to global fetch")).toBe("warn");
    expect(guessLevel("Capture retry scheduled")).toBe("warn");
    expect(guessLevel("Capture attempt")).toBe("info");
  });
  it("ranks a failure word above a warn word", () => {
    expect(guessLevel("provider failed, falling back")).toBe("error");
  });
});

afterAll(() => {
  if (prior === undefined) delete process.env.OMMS_LOG_FILE;
  else process.env.OMMS_LOG_FILE = prior;
  rmSync(dir, { recursive: true, force: true });
});
