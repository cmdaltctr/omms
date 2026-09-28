import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG } from "../src/config.js";
import { scheduleAutoBackfill } from "../src/importer/auto-backfill.js";
import { tryAcquireBackfillLock } from "../src/importer/backfill-lock.js";
import { readImportRun, setBackfillPaused, startImportRun } from "../src/importer/import-runs.js";
import { runHistoryImport } from "../src/importer/run-import.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const previousStorage = CONFIG.storagePath;
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

function store() {
  const directory = mkdtempSync(join(tmpdir(), "omms-import-runs-"));
  directories.push(directory);
  CONFIG.storagePath = directory;
  return directory;
}

const importArgs = {
  help: false,
  dryRun: false,
  force: false,
  skipMemories: false,
  skipProfile: true,
  scope: "all-projects" as const,
  pathMaps: [],
  errors: [],
};

describe("import run records", () => {
  it("stores only numbers, throttles writes, and never stores the prompt preview", async () => {
    const directory = store();
    let now = 1_000;
    const recorder = await startImportRun("pi", "cli", { now: () => now, intervalMs: 1_000 });
    const db = await tursoConnectionManager.getConnection(join(directory, "import-ledger.db"));
    const writes = async () =>
      (await db.get<{ done: number }>("SELECT done FROM import_runs WHERE host = 'pi'"))!.done;

    recorder.progress(1, 10);
    now += 100;
    recorder.progress(2, 10);
    now += 100;
    recorder.progress(3, 10);
    await recorder.finish("done", { total: 10, done: 3, imported: 3 });
    const row = await db.get<Record<string, unknown>>(
      "SELECT * FROM import_runs WHERE host = 'pi'"
    );
    expect(JSON.parse(String(row!.samples))).toEqual([{ at: 1_000, done: 1 }]);
    expect(await writes()).toBe(3);
    expect(JSON.stringify(row)).not.toContain("private turn");
    expect(await readImportRun("pi")).toMatchObject({
      surface: "cli",
      state: "done",
      total: 10,
      done: 3,
      imported: 3,
      percent: 30,
    });
  });

  it("shows a running row whose process is gone as stopped", async () => {
    const directory = store();
    await startImportRun("opencode", "cli");
    const db = await tursoConnectionManager.getConnection(join(directory, "import-ledger.db"));
    await db.run("UPDATE import_runs SET pid = 2147483647 WHERE host = 'opencode'");
    expect((await readImportRun("opencode"))?.state).toBe("stopped");
  });

  it("refuses a second model-calling run for the same host held by another process", async () => {
    const home = store();
    const script = join(home, "holder.mjs");
    const url = (path: string) => pathToFileURL(join(import.meta.dir, path)).href;
    writeFileSync(
      script,
      `const { CONFIG } = await import(${JSON.stringify(url("../src/config.ts"))});
      CONFIG.storagePath = ${JSON.stringify(home)};
      const { tryAcquireBackfillLock } = await import(${JSON.stringify(url("../src/importer/backfill-lock.ts"))});
      const release = await tryAcquireBackfillLock("pi", ${JSON.stringify(home)});
      console.log(release ? "held" : "refused");
      await new Promise((resolve) => process.stdin.once("data", resolve));
      await release?.();`
    );
    const child = Bun.spawn(["bun", "run", script], {
      cwd: home,
      stdin: "pipe",
      stdout: "pipe",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    try {
      const reader = child.stdout.getReader();
      let output = "";
      while (!/held|refused/.test(output)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += new TextDecoder().decode(chunk.value);
      }
      expect(output).toContain("held");
      await expect(
        runHistoryImport("pi", importArgs, { cwd: home, models: {}, track: { surface: "cli" } })
      ).rejects.toThrow("A Pi import is already running");
      child.stdin.write("\n");
      child.stdin.end();
      expect(await child.exited).toBe(0);
    } finally {
      child.kill();
    }
    const release = await tryAcquireBackfillLock("pi", home);
    expect(release).not.toBeNull();
    await release!();
  });
});

describe("progress counts real work", () => {
  it("leaves already-imported units out of done and total, and keeps the total when paused", async () => {
    store();
    let now = 0;
    const recorder = await startImportRun("pi", "cli", { now: () => now, intervalMs: 0 });
    // What runHistoryImport feeds the recorder for 731 processed, 729 already done.
    recorder.progress(731 - 729, 736 - 729);
    now = 1;
    await recorder.finish("paused", { done: 2, imported: 2 });
    expect(await readImportRun("pi")).toMatchObject({ total: 7, done: 2, state: "paused" });
  });

  it("samples at most every 15 seconds so the rate window spans minutes", async () => {
    const directory = store();
    let now = 0;
    const recorder = await startImportRun("pi", "cli", { now: () => now, intervalMs: 1_000 });
    for (let second = 0; second <= 60; second++) {
      now = second * 1_000;
      recorder.progress(second, 1_000);
    }
    await recorder.finish("done", {});
    const db = await tursoConnectionManager.getConnection(join(directory, "import-ledger.db"));
    const row = await db.get<{ samples: string }>(
      "SELECT samples FROM import_runs WHERE host = 'pi'"
    );
    expect(JSON.parse(row!.samples).map((s: { at: number }) => s.at)).toEqual([
      0, 15_000, 30_000, 45_000, 60_000,
    ]);
  });
});

describe("pausing a backfill", () => {
  it("aborts an in-process run once a progress write sees the flag", async () => {
    store();
    let now = 0;
    let paused = false;
    const recorder = await startImportRun("pi", "web", {
      now: () => now,
      intervalMs: 1,
      onPause: () => (paused = true),
    });
    await setBackfillPaused("pi", true);
    now = 10;
    recorder.progress(1, 5);
    await recorder.finish("paused", {});
    expect(paused).toBe(true);
    expect(recorder.pauseRequested).toBe(true);
  });

  for (const host of ["pi", "opencode"] as const) {
    it(`keeps ${host}'s backfill paused across a restart until resume`, async () => {
      const directory = store();
      await setBackfillPaused(host, true);
      // A fresh connection stands in for the next host start.
      await tursoConnectionManager.closeAll();
      const calls: boolean[] = [];
      const options = {
        host,
        cwd: directory,
        wait: async () => {},
        enabled: () => true,
        notify: () => {},
        resolveModels: async () => ({ model: "external/m", models: {} }),
        run: async (_host: string, args: { dryRun: boolean }) => {
          calls.push(args.dryRun);
          return {
            unitsWouldImport: 0,
            unitsImported: 0,
            unitsSkipped: 0,
            unitsFailed: 0,
            unresolvableSessions: [],
            unresolvedProjects: [],
          };
        },
      };
      await scheduleAutoBackfill(options as never);
      expect(calls).toEqual([]);
      expect((await readImportRun(host))?.paused).toBe(true);
      await setBackfillPaused(host, false);
      await scheduleAutoBackfill(options as never);
      expect(calls).toEqual([true]);
    });
  }
});
