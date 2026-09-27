import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSettingsTraces,
  readSettingsTrace,
  deleteSettingsTrace,
} from "../src/services/settings-traces.js";

const dir = mkdtempSync(join(tmpdir(), "omms-traces-"));
const previous = process.env.OMMS_LOG_FILE;
process.env.OMMS_LOG_FILE = join(dir, "omms.log");
mkdirSync(join(dir, "traces"));
writeFileSync(join(dir, "traces", "capture-2026-01-10.jsonl"), '{"outcome":"saved"}\n');
afterAll(() => {
  if (previous === undefined) delete process.env.OMMS_LOG_FILE;
  else process.env.OMMS_LOG_FILE = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe("settings traces", () => {
  it("lists and reads trace files", async () => {
    expect((await listSettingsTraces())[0]).toMatchObject({
      file: "capture-2026-01-10.jsonl",
      date: "2026-01-10",
    });
    expect(await readSettingsTrace("capture-2026-01-10.jsonl")).toContain("saved");
  });
  it("rejects traversal in read and delete", async () => {
    await expect(readSettingsTrace("../omms.log")).rejects.toThrow();
    await expect(deleteSettingsTrace("%2e%2e%2fomms.log")).rejects.toThrow();
  });
  it("deletes only the requested trace", async () => {
    await deleteSettingsTrace("capture-2026-01-10.jsonl");
    expect(await listSettingsTraces()).toEqual([]);
  });
});
