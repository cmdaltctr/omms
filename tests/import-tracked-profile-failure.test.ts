import { afterAll, expect, it, mock } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CONFIG } from "../src/config.js";
import type { PiSessionEntry } from "../src/importer/pi-conversation.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const previousStorage = CONFIG.storagePath;
const directory = mkdtempSync(join(process.env.OMMS_TEST_HOME!, "tracked-profile-failure-"));
CONFIG.storagePath = join(directory, "store");
for (const args of [
  ["init", "-q"],
  ["config", "user.email", "test@example.invalid"],
  ["config", "user.name", "Import Test"],
]) {
  const result = spawnSync("git", args, { cwd: directory });
  if (result.status !== 0) throw new Error(result.stderr.toString());
}

// Reader and storage ports avoid loading a host SDK or an embedding model.
mock.module("../src/importer/session-loader.js", () => ({
  loadPiSessionForImport: (file: string) => {
    const [header, ...branch] = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return {
      sessionId: header.id,
      sourceFile: file,
      cwd: header.cwd,
      branch: branch as PiSessionEntry[],
    };
  },
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    getEmbeddingInitError: () => null,
    listMemories: async () => ({ success: true, memories: [] }),
  },
}));
const embeddingStub = { initError: null, isWarmedUp: true };
mock.module("../src/services/embedding.js", () => ({
  embeddingService: embeddingStub,
  EmbeddingService: class {
    static getInstance() {
      return embeddingStub;
    }
  },
}));

const { runHistoryImport } = await import("../src/importer/run-import.js");
const { readImportRun } = await import("../src/importer/import-runs.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");

afterAll(async () => {
  await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
  mock.restore();
});

function importArgs(id: string, skipProfile: boolean) {
  const source = join(directory, `${id}.jsonl`);
  const timestamp = "2026-01-01T10:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id, cwd: directory, timestamp },
    {
      type: "message",
      id: "user",
      parentId: null,
      timestamp,
      message: {
        role: "user",
        content: `Add regression coverage for the ${id} import outcome and preserve retry behaviour.`,
      },
    },
    {
      type: "message",
      id: "assistant",
      parentId: "user",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Added fixture regression coverage." }],
      },
    },
  ];
  writeFileSync(source, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return {
    help: false,
    dryRun: false,
    force: false,
    skipMemories: !skipProfile,
    skipProfile,
    scope: "current-project" as const,
    source,
    pathMaps: [],
    errors: [],
  };
}

for (const [id, message, code] of [
  ["timeout", "timeout: secret-fixture-key raw-provider-reply", "timeout"],
  ["validation", "validation: secret-fixture-key raw-provider-reply", "invalid-reply"],
  ["generic", "offline: secret-fixture-key raw-provider-reply", "error"],
] as const) {
  it(`persists a returned ${id} profile failure with only its reason code`, async () => {
    let calls = 0;
    const report = await runHistoryImport("pi", importArgs(id, false), {
      cwd: directory,
      savedPathMaps: [],
      track: { surface: "cli" },
      models: {
        profile: {
          provider: "test",
          modelId: "fake",
          complete: async () => {
            calls++;
            throw new Error(message);
          },
        },
      },
    });
    expect(calls).toBe(2);
    expect(report.profile?.error).toBe(message);
    const db = await tursoConnectionManager.getConnection(
      join(CONFIG.storagePath, "import-ledger.db")
    );
    const row = await db.get("SELECT * FROM import_runs WHERE host = 'pi'");
    expect(JSON.stringify(row)).not.toContain("secret-fixture-key");
    expect(JSON.stringify(row)).not.toContain("raw-provider-reply");
    expect(JSON.stringify(row)).not.toContain("Add regression coverage");
    expect(await readImportRun("pi")).toMatchObject({
      state: "failed",
      error: code,
      surface: "cli",
      phase: "profile",
      failed: 0,
    });
  });
}

it("keeps a finished run with a failed memory exchange historically done", async () => {
  let calls = 0;
  const report = await runHistoryImport("pi", importArgs("memory-failure", true), {
    cwd: directory,
    savedPathMaps: [],
    track: { surface: "cli" },
    models: {
      capture: {
        summarize: async () => {
          calls++;
          throw new Error("fixture capture failure");
        },
      },
    },
  });
  expect(calls).toBe(1);
  expect(report.unitsFailed).toBe(1);
  expect(report.profile).toBeUndefined();
  expect(await readImportRun("pi")).toMatchObject({
    state: "done",
    error: null,
    total: 1,
    done: 1,
    failed: 1,
    imported: 0,
    skipped: 0,
  });
});
