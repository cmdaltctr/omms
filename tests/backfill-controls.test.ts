import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The scheduler is replaced, so no run reads history or calls a model.
const scheduled: Array<{ host: string; userStarted?: boolean; signal: AbortSignal }> = [];
mock.module("../src/importer/auto-backfill.js", () => ({
  scheduleAutoBackfill: (options: { host: string; userStarted?: boolean; signal: AbortSignal }) => {
    scheduled.push(options);
    return new Promise<void>((resolve) =>
      options.signal.addEventListener("abort", () => resolve())
    );
  },
}));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { CONFIG } = await import("../src/config.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { BackfillControls } = await import("../src/importer/backfill-controls.js");
const { readImportRun, setBackfillPaused, startImportRun } =
  await import("../src/importer/import-runs.js");

const storage = mkdtempSync(join(tmpdir(), "omms-backfill-controls-"));
const saved = {
  storagePath: CONFIG.storagePath,
  memoryModel: CONFIG.memoryModel,
  memoryApiUrl: CONFIG.memoryApiUrl,
  memoryApiKey: CONFIG.memoryApiKey,
  memoryProvider: CONFIG.memoryProvider,
};
CONFIG.storagePath = storage;
CONFIG.memoryProvider = "openai-chat";

afterAll(async () => {
  await tursoConnectionManager.closeAll();
  Object.assign(CONFIG, saved);
  rmSync(storage, { recursive: true, force: true });
});

function configureExternal(overrides: Record<string, string | undefined> = {}) {
  Object.assign(CONFIG, {
    memoryModel: "m",
    memoryApiUrl: "https://api.invalid/v1",
    memoryApiKey: "k",
    ...overrides,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(async () => {
  scheduled.length = 0;
  configureExternal();
  await setBackfillPaused("claude-code", false);
});

describe("Claude Code backfill controls", () => {
  it("names the missing external API setting and starts nothing", async () => {
    configureExternal({ memoryApiUrl: undefined });
    const controls = new BackfillControls();
    const status = await controls.status();
    expect(status["claude-code"].runNowUnavailable).toBe("memoryApiUrl is not configured");
    await expect(controls.runNow("claude-code", storage)).rejects.toMatchObject({
      status: 409,
      message: "memoryApiUrl is not configured",
    });
    expect(await controls.startAuto("claude-code", storage)).toEqual({ started: false });
    expect(scheduled).toHaveLength(0);
  });

  it("runs, holds a single run, pauses, and resumes", async () => {
    const controls = new BackfillControls();
    expect((await controls.status())["claude-code"].runNowUnavailable).toBeNull();

    expect(await controls.runNow("claude-code", storage)).toEqual({ started: true });
    await settle();
    expect(scheduled.map((run) => [run.host, run.userStarted])).toEqual([["claude-code", true]]);
    await expect(controls.runNow("claude-code", storage)).rejects.toMatchObject({
      status: 409,
      message: "A Claude Code import is already running",
    });
    expect(await controls.startAuto("claude-code", storage)).toEqual({ started: false });

    expect(await controls.pause("claude-code")).toEqual({ paused: true });
    expect(scheduled[0]!.signal.aborted).toBe(true);
    expect((await readImportRun("claude-code"))?.paused).toBe(true);
    await settle();
    await expect(controls.runNow("claude-code", storage)).rejects.toMatchObject({
      message: "Claude Code's backfill is paused; resume it first",
    });

    expect(await controls.resume("claude-code", storage)).toEqual({ started: true });
    await settle();
    expect((await readImportRun("claude-code"))?.paused).toBe(false);
    expect(scheduled).toHaveLength(2);
    await controls.pause("claude-code");
  });

  it("refuses a run while another process holds a Claude Code import", async () => {
    const controls = new BackfillControls();
    const recorder = await startImportRun("claude-code", "cli");
    await expect(controls.runNow("claude-code", storage)).rejects.toMatchObject({
      message: "A Claude Code import is already running",
    });
    await recorder.finish("done", {});
  });

  it("starts the automatic run once, without the user-started flag", async () => {
    const controls = new BackfillControls();
    expect(await controls.startAuto("claude-code", storage)).toEqual({ started: true });
    expect(await controls.startAuto("claude-code", storage)).toEqual({ started: false });
    await settle();
    expect(scheduled.map((run) => [run.host, run.userStarted])).toEqual([
      ["claude-code", undefined],
    ]);
    await controls.pause("claude-code");
  });
});
