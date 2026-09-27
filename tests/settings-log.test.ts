import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettingsLog } from "../src/services/settings-log.js";

const dir = mkdtempSync(join(tmpdir(), "omms-log-"));
const prior = process.env.OMMS_LOG_FILE;
process.env.OMMS_LOG_FILE = join(dir, "omms.log");
afterEach(() => rmSync(process.env.OMMS_LOG_FILE!, { force: true }));

describe("settings log", () => {
  it("returns an empty result when no log has been written", async () => {
    expect((await readSettingsLog()).lines).toEqual([]);
  });
  it("filters capture attempts and limits the number of lines", async () => {
    writeFileSync(
      process.env.OMMS_LOG_FILE!,
      "header\nCapture attempt saved\nother\nCapture attempt failed\n"
    );
    expect((await readSettingsLog(1, true)).lines).toEqual(["Capture attempt failed"]);
    expect((await readSettingsLog(2)).lines).toEqual(["other", "Capture attempt failed"]);
  });
  it("reads no more than the last 256 KB", async () => {
    writeFileSync(
      process.env.OMMS_LOG_FILE!,
      `secret\n${"x".repeat(300_000)}\nCapture attempt saved\n`
    );
    const result = await readSettingsLog();
    expect(result.lines).toEqual(["Capture attempt saved"]);
  });
});

afterAll(() => {
  if (prior === undefined) delete process.env.OMMS_LOG_FILE;
  else process.env.OMMS_LOG_FILE = prior;
  rmSync(dir, { recursive: true, force: true });
});
