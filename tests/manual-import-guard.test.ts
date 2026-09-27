import { afterEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { scheduleAutoBackfill } from "../src/importer/auto-backfill.js";
import { beginManualImport, isManualImportRunning } from "../src/importer/manual-import-guard.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const previousStorage = CONFIG.storagePath;
let directory: string;
afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

it("prevents a same-host backfill while a manual import runs", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-manual-guard-"));
  CONFIG.storagePath = directory;
  const end = beginManualImport("pi");
  expect(isManualImportRunning("pi")).toBe(true);
  expect(isManualImportRunning("opencode")).toBe(false);
  try {
    await scheduleAutoBackfill({
      host: "pi",
      cwd: directory,
      wait: async () => {},
      enabled: () => true,
      notify: () => {},
      resolveModels: async () => {
        throw new Error("should not resolve");
      },
      run: async () => {
        throw new Error("should not import");
      },
    });
  } finally {
    end();
  }
  expect(isManualImportRunning("pi")).toBe(false);
});
