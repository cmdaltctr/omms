import { afterEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { scheduleAutoBackfill } from "../src/importer/auto-backfill.js";
import { readBackfillStatus } from "../src/services/backfill-state.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const previousStorage = CONFIG.storagePath;
let directory: string;
afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

it("uses a fixed cutoff and only resolves a model for pending work", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-backfill-"));
  CONFIG.storagePath = directory;
  const calls: Array<{ dryRun: boolean; until?: number }> = [];
  const notices: string[] = [];
  let modelsResolved = 0;
  const run = async (
    _host: string,
    args: { dryRun: boolean; until?: number },
    context: { onProgress?: (processed: number, total: number, promptPreview: string) => void }
  ) => {
    calls.push({ dryRun: args.dryRun, until: args.until });
    if (!args.dryRun) context.onProgress?.(1, 2, "private turn");
    return {
      unitsWouldImport: args.dryRun ? 2 : 0,
      unitsImported: args.dryRun ? 0 : 2,
      unitsSkipped: 0,
      unitsFailed: 0,
      unresolvableSessions: [],
      unresolvedProjects: [],
    };
  };
  const options = {
    host: "pi" as const,
    cwd: directory,
    run,
    wait: async () => {},
    now: () => 100,
    enabled: () => true,
    notify: (text: string) => notices.push(text),
    resolveModels: async () => {
      modelsResolved++;
      return { model: "zai/glm-5-turbo", models: {} };
    },
  };
  await scheduleAutoBackfill(options);
  expect(calls).toEqual([
    { dryRun: true, until: 100 },
    { dryRun: false, until: 100 },
  ]);
  expect(modelsResolved).toBe(1);
  expect(notices[0]).toContain("autoBackfill");
  expect(notices[0]).toContain("2");
  expect(notices[0]).toContain("zai/glm-5-turbo");
  expect(notices).toHaveLength(2);
  expect(notices.join(" ")).not.toContain("private turn");
  expect((await readBackfillStatus("pi"))?.state).toBe("done");
  calls.length = 0;
  await scheduleAutoBackfill({
    ...options,
    now: () => 200,
    run: async (_host: string, args: { dryRun: boolean; until?: number }) => {
      calls.push({ dryRun: args.dryRun, until: args.until });
      return {
        unitsWouldImport: 0,
        unitsImported: 0,
        unitsSkipped: 0,
        unitsFailed: 0,
        unresolvableSessions: [],
        unresolvedProjects: [],
      };
    },
  });
  expect(calls).toEqual([{ dryRun: true, until: 100 }]);
  expect(modelsResolved).toBe(1);
});

it("does not resolve models or create a cutoff when disabled", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-disabled-"));
  CONFIG.storagePath = directory;
  await scheduleAutoBackfill({
    host: "pi",
    cwd: directory,
    wait: async () => {},
    enabled: () => false,
    notify: () => {
      throw new Error("notice");
    },
    resolveModels: async () => {
      throw new Error("model");
    },
    run: async () => {
      throw new Error("import");
    },
  });
  expect(await readBackfillStatus("pi")).toBeNull();
});

it("does not create a cutoff after its session ends during startup", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-session-stop-"));
  CONFIG.storagePath = directory;
  const controller = new AbortController();
  let calls = 0;
  await scheduleAutoBackfill({
    host: "pi",
    cwd: directory,
    signal: controller.signal,
    wait: async () => {
      controller.abort();
    },
    enabled: () => true,
    notify: () => {
      calls++;
    },
    resolveModels: async () => {
      calls++;
      throw new Error("unexpected model");
    },
    run: async () => {
      calls++;
      throw new Error("unexpected import");
    },
  });
  expect(calls).toBe(0);
  expect(await readBackfillStatus("pi")).toBeNull();
});

it("cancels the real startup timer promptly when the session ends", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-delay-stop-"));
  CONFIG.storagePath = directory;
  const controller = new AbortController();
  const pending = scheduleAutoBackfill({
    host: "pi",
    cwd: directory,
    signal: controller.signal,
    enabled: () => true,
    notify: () => {
      throw new Error("unexpected notice");
    },
    resolveModels: async () => {
      throw new Error("unexpected model");
    },
    run: async () => {
      throw new Error("unexpected import");
    },
  });
  controller.abort();
  await Promise.race([
    pending,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("startup delay was not cancelled")), 250)
    ),
  ]);
  expect(await readBackfillStatus("pi")).toBeNull();
});

it("stops an in-flight run on session shutdown and releases the host lock", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-session-run-"));
  CONFIG.storagePath = directory;
  const controller = new AbortController();
  let entered = false;
  const options = {
    host: "pi" as const,
    cwd: directory,
    wait: async () => {},
    enabled: () => true,
    notify: () => {},
    resolveModels: async () => ({ model: "zai/model", models: {} }),
  };
  await scheduleAutoBackfill({
    ...options,
    signal: controller.signal,
    run: async (_host, args, context) => {
      if (args.dryRun)
        return {
          unitsWouldImport: 2,
          unitsImported: 0,
          unitsSkipped: 0,
          unitsFailed: 0,
          unresolvableSessions: [],
        };
      entered = true;
      controller.abort();
      context.onProgress?.(1, 2, "private text");
      expect(context.signal?.aborted).toBe(true);
      return {
        unitsWouldImport: 0,
        unitsImported: 1,
        unitsSkipped: 0,
        unitsFailed: 0,
        unresolvableSessions: [],
      };
    },
  });
  expect(entered).toBe(true);
  expect((await readBackfillStatus("pi"))?.state).toBe("stopped");
  await scheduleAutoBackfill({
    ...options,
    run: async () => ({
      unitsWouldImport: 0,
      unitsImported: 0,
      unitsSkipped: 0,
      unitsFailed: 0,
      unresolvableSessions: [],
    }),
  });
  expect((await readBackfillStatus("pi"))?.state).toBe("done");
});

it("records a failed state without importing when a model cannot resolve", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-no-model-"));
  CONFIG.storagePath = directory;
  let imports = 0;
  await scheduleAutoBackfill({
    host: "opencode",
    cwd: directory,
    wait: async () => {},
    enabled: () => true,
    now: () => 42,
    notify: () => {},
    resolveModels: async () => {
      throw new Error("model not connected");
    },
    run: async () => {
      imports++;
      return {
        unitsWouldImport: 1,
        unitsImported: 0,
        unitsSkipped: 0,
        unitsFailed: 0,
        unresolvableSessions: [],
      };
    },
  });
  expect(imports).toBe(1);
  expect(await readBackfillStatus("opencode")).toMatchObject({
    cutoff: 42,
    state: "failed",
    error: "model not connected",
  });
});

it("stops after the current exchange when the global switch turns off", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-stop-"));
  CONFIG.storagePath = directory;
  const original = CONFIG.autoBackfill;
  let time = 0;
  try {
    await scheduleAutoBackfill({
      host: "pi",
      cwd: directory,
      wait: async () => {},
      enabled: () => true,
      now: () => time,
      notify: () => {},
      resolveModels: async () => ({ model: "zai/model", models: {} }),
      run: async (_host, args, context) => {
        if (args.dryRun)
          return {
            unitsWouldImport: 3,
            unitsImported: 0,
            unitsSkipped: 0,
            unitsFailed: 0,
            unresolvableSessions: [],
          };
        time = 5_000;
        CONFIG.autoBackfill = false;
        context.onProgress?.(1, 3, "private text");
        expect(context.signal?.aborted).toBe(true);
        return {
          unitsWouldImport: 0,
          unitsImported: 1,
          unitsSkipped: 0,
          unitsFailed: 0,
          unresolvableSessions: [],
        };
      },
    });
    expect(await readBackfillStatus("pi")).toMatchObject({
      state: "stopped",
      counts: { imported: 1, pending: 2 },
    });
  } finally {
    CONFIG.autoBackfill = original;
  }
});

it("stops after five failed summaries and retries on the next start", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-failure-"));
  CONFIG.storagePath = directory;
  let attempts = 0;
  let online = false;
  const run = async (
    _host: string,
    args: { dryRun: boolean },
    context: {
      models: {
        capture?: {
          summarize: (request: {
            context: string;
            sessionId: string;
            projectDirectory: string;
            userPrompt: string;
          }) => Promise<unknown>;
        };
      };
      signal?: AbortSignal;
    }
  ) => {
    if (args.dryRun)
      return {
        unitsWouldImport: 6,
        unitsImported: 0,
        unitsSkipped: 0,
        unitsFailed: 0,
        unresolvableSessions: [],
      };
    for (let i = 0; i < 6 && !context.signal?.aborted; i++) {
      try {
        await context.models.capture!.summarize({
          context: "",
          sessionId: "s",
          projectDirectory: directory,
          userPrompt: "test",
        });
      } catch {
        /* The importer records each failed unit for a later retry. */
      }
    }
    return {
      unitsWouldImport: 0,
      unitsImported: online ? 6 : 0,
      unitsSkipped: 0,
      unitsFailed: online ? 0 : attempts,
      unresolvableSessions: [],
    };
  };
  const options = {
    host: "pi" as const,
    cwd: directory,
    wait: async () => {},
    enabled: () => true,
    notify: () => {},
    run,
    resolveModels: async () => ({
      model: "zai/model",
      models: {
        capture: {
          summarize: async () => {
            attempts++;
            if (!online) throw new Error("api_key=private");
            return { summary: "done", type: "feature", tags: [] };
          },
        },
      },
    }),
  };
  await scheduleAutoBackfill(options);
  expect(attempts).toBe(5);
  expect(await readBackfillStatus("pi")).toMatchObject({ state: "stopped" });
  expect((await readBackfillStatus("pi"))?.error).not.toContain("private");
  online = true;
  await scheduleAutoBackfill(options);
  expect(attempts).toBe(11);
  expect((await readBackfillStatus("pi"))?.state).toBe("done");
});
