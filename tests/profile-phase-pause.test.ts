import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { readImportRun, setBackfillPaused, startImportRun } from "../src/importer/import-runs.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const previousStorage = CONFIG.storagePath;
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

function store() {
  const directory = mkdtempSync(join(process.env.OMMS_TEST_HOME!, "profile-phase-pause-"));
  directories.push(directory);
  CONFIG.storagePath = directory;
}

describe("profile-phase pause control", () => {
  for (const host of ["pi", "opencode", "claude-code"] as const) {
    it(`observes ${host}'s pause during profile-only progress before finish`, async () => {
      store();
      let calls = 0;
      let notifyPause!: () => void;
      const paused = new Promise<boolean>((resolve) => {
        notifyPause = () => resolve(true);
      });
      const recorder = await startImportRun(host, "cli", {
        onPause: () => {
          calls++;
          notifyPause();
        },
      });
      await setBackfillPaused(host, true);
      recorder.profileProgress(1, 5);
      recorder.profileProgress(2, 5);
      let timeout!: ReturnType<typeof setTimeout>;
      const observed = await Promise.race([
        paused,
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1_000);
        }),
      ]);
      clearTimeout(timeout);
      const requestedBeforeFinish = recorder.pauseRequested;
      await recorder.finish("paused", {});

      expect(observed).toBe(true);
      expect(requestedBeforeFinish).toBe(true);
      expect(calls).toBe(1);
      expect(await readImportRun(host)).toMatchObject({
        state: "paused",
        paused: true,
        phase: "profile",
        profileDone: 2,
        profileTotal: 5,
        total: 0,
        done: 0,
      });
    });
  }

  it("shares the once-only pause notification across profile and exchange writes", async () => {
    store();
    let calls = 0;
    const recorder = await startImportRun("opencode", "web", {
      intervalMs: 0,
      onPause: () => {
        calls++;
      },
    });
    await setBackfillPaused("opencode", true);
    recorder.profileProgress(1, 3);
    recorder.progress(4, 4);
    recorder.profileProgress(2, 3);
    recorder.progress(4, 4);
    await recorder.finish("paused", { imported: 4 });

    expect(calls).toBe(1);
    expect(recorder.pauseRequested).toBe(true);
    expect(await readImportRun("opencode")).toMatchObject({
      state: "paused",
      phase: "profile",
      profileDone: 2,
      profileTotal: 3,
      total: 4,
      done: 4,
      imported: 4,
    });
  });

  it("flushes profile progress without requesting a pause when the flag is clear", async () => {
    store();
    let calls = 0;
    const recorder = await startImportRun("pi", "cli", {
      onPause: () => {
        calls++;
      },
    });
    recorder.profileProgress(0, 3);
    recorder.profileProgress(1, 3);
    recorder.profileProgress(3, 3);
    await recorder.finish("done", {});

    expect(calls).toBe(0);
    expect(recorder.pauseRequested).toBe(false);
    expect(await readImportRun("pi")).toMatchObject({
      state: "done",
      paused: false,
      phase: "profile",
      profileDone: 3,
      profileTotal: 3,
    });
  });

  it("still flushes later profile writes when the pause callback throws", async () => {
    store();
    let calls = 0;
    const recorder = await startImportRun("opencode", "cli", {
      onPause: () => {
        calls++;
        throw new Error("fixture pause callback failure");
      },
    });
    await setBackfillPaused("opencode", true);
    recorder.profileProgress(1, 5);
    recorder.profileProgress(2, 5);
    await recorder.finish("paused", {});

    expect(calls).toBe(1);
    expect(recorder.pauseRequested).toBe(true);
    expect(await readImportRun("opencode")).toMatchObject({
      state: "paused",
      phase: "profile",
      profileDone: 2,
      profileTotal: 5,
    });
  });
});
