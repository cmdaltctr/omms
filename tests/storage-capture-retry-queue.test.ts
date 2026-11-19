import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the capture retry queue store (storage port slice S3). Real stores in the
// isolated test home; no mocks. The store reads the active storage folder on every call, and the
// retention hours from the config it is handed on every call.
const config = await import("../src/config.js");
const { initConfig, refreshConfigIfChanged } = config;
const queue = await import("../src/services/storage/capture-retry-queue.js");
const { createStoredSpace, spaceFiles, switchStoredSpace } =
  await import("../src/services/spaces/registry-store.js");
type CaptureWorkUnit = import("../src/core/capture.js").CaptureWorkUnit;

const files = spaceFiles(join(homedir(), ".omms"));
let project: string;
const folders: string[] = [];
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 18, 12);
const network = { reason: "call-error" as const };

function unit(promptId: string, overrides: Partial<CaptureWorkUnit> = {}): CaptureWorkUnit {
  return {
    host: "pi",
    hostSessionId: "session-1",
    sourceType: "live-capture",
    projectDirectory: "/work/project",
    userPrompt: "Fix the login bug",
    promptId,
    textResponses: ["I changed the session check."],
    toolCalls: [{ name: "edit", input: "src/login.ts" }],
    sourceEntryIds: [promptId],
    ...overrides,
  };
}

function freshFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "omms-storage-retry-"));
  folders.push(folder);
  return folder;
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-storage-retry-project-"));
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(
    join(homedir(), ".config", "omms", "omms.jsonc"),
    JSON.stringify({ embeddingDimensions: 4 })
  );
  initConfig(project);
});
afterAll(async () => {
  config.CONFIG.storagePath = join(homedir(), ".omms", "data");
  await cleanupTursoTestDirectory(files.spacesRoot);
  await cleanupTursoTestDirectory(project);
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
  rmSync(files.registryPath, { force: true });
});

describe("capture retry queue storage", () => {
  it("(r) reads rows that a raw client wrote, with the stored column names", async () => {
    const folder = freshFolder();
    config.CONFIG.storagePath = folder;
    config.CONFIG.captureRetryRetentionHours = 72;
    const raw = createClient({ url: `file:${join(folder, "user-prompts.db")}` });
    await raw.execute(`CREATE TABLE IF NOT EXISTS capture_retry_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
          project_directory TEXT NOT NULL, work_unit TEXT NOT NULL,
          size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
          last_reason TEXT, claimed_until INTEGER,
          UNIQUE (host, turn_id)
        )`);
    const json = JSON.stringify(unit("raw-1"));
    await raw.execute({
      sql: `INSERT INTO capture_retry_queue (host, session_id, turn_id, project_directory, work_unit,
        size_bytes, created_at, attempts, next_attempt_at, last_reason, claimed_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      args: ["pi", "session-1", "raw-1", "/work/project", json, json.length, T0, 2, T0 + 10, "x"],
    });
    raw.close();

    expect(await queue.listDueCaptureRetries("pi", config.CONFIG, T0 + 5)).toEqual([]);
    const due = await queue.listDueCaptureRetries("pi", config.CONFIG, T0 + 10);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      host: "pi",
      sessionId: "session-1",
      turnId: "raw-1",
      createdAt: T0,
      attempts: 2,
    });
    expect(due[0]!.workUnit.userPrompt).toBe("Fix the login bug");
    expect(await queue.countCaptureRetries(config.CONFIG)).toEqual({
      opencode: 0,
      pi: 1,
      "claude-code": 0,
    });
  });

  it("(w) writes through the API and a raw client sees the same rows", async () => {
    const folder = freshFolder();
    config.CONFIG.storagePath = folder;
    config.CONFIG.captureRetryRetentionHours = 72;
    expect(await queue.enqueueCaptureRetry(unit("w-1"), network, config.CONFIG, T0)).toBe("queued");
    expect(await queue.enqueueCaptureRetry(unit("w-1"), network, config.CONFIG, T0 + 1)).toBe(
      "queued"
    );
    const id = (await queue.listDueCaptureRetries("pi", config.CONFIG, T0 + 10 * HOUR))[0]!.id;
    expect(await queue.claimCaptureRetry(id, config.CONFIG, T0)).toBe(true);
    expect(await queue.claimCaptureRetry(id, config.CONFIG, T0 + 1)).toBe(false);
    // The lease lasts 5 minutes; after that another process may claim the row.
    expect(await queue.claimCaptureRetry(id, config.CONFIG, T0 + 6 * 60 * 1000)).toBe(true);
    expect(await queue.makeCaptureRetriesDue("pi", config.CONFIG, T0 + 7)).toBe(1);

    const raw = createClient({ url: `file:${join(folder, "user-prompts.db")}` });
    const rows = (await raw.execute("SELECT * FROM capture_retry_queue")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      host: "pi",
      session_id: "session-1",
      turn_id: "w-1",
      project_directory: "/work/project",
      created_at: T0,
      attempts: 2,
      next_attempt_at: T0 + 7,
      last_reason: "call-error",
    });
    expect(Number(rows[0]!.claimed_until)).toBeGreaterThan(T0);

    await queue.rescheduleCaptureRetry({ id, attempts: 2 }, network, config.CONFIG, T0 + 20);
    const after = (await raw.execute("SELECT attempts, claimed_until FROM capture_retry_queue"))
      .rows[0]!;
    expect(Number(after.attempts)).toBe(3);
    expect(after.claimed_until).toBeNull();

    await queue.deleteCaptureRetry(id, config.CONFIG);
    expect((await raw.execute("SELECT COUNT(*) AS n FROM capture_retry_queue")).rows[0]!.n).toBe(0);
    raw.close();
  });

  it("(w) reads the retention hours from the config it is handed on every call", async () => {
    const folder = freshFolder();
    config.CONFIG.storagePath = folder;
    config.CONFIG.captureRetryRetentionHours = 72;
    await queue.enqueueCaptureRetry(unit("old"), network, config.CONFIG, T0 - 73 * HOUR);
    await queue.enqueueCaptureRetry(unit("new"), network, config.CONFIG, T0 - HOUR);

    config.CONFIG.captureRetryRetentionHours = 72;
    expect(await queue.pruneCaptureRetries(config.CONFIG, T0)).toBe(1);
    expect((await queue.listDueCaptureRetries("pi", config.CONFIG, T0 + HOUR))[0]!.turnId).toBe(
      "new"
    );

    config.CONFIG.captureRetryRetentionHours = 0;
    expect(await queue.enqueueCaptureRetry(unit("off"), network, config.CONFIG, T0)).toBe("off");
    expect(await queue.pruneCaptureRetries(config.CONFIG, T0)).toBe(1);
    expect(await queue.countCaptureRetries(config.CONFIG)).toEqual({
      opencode: 0,
      pi: 0,
      "claude-code": 0,
    });
    config.CONFIG.captureRetryRetentionHours = 72;
  });

  it("(s) a space switch gives the new space its own queue and leaves the old one unchanged", async () => {
    config.CONFIG.storagePath = join(homedir(), ".omms", "data");
    config.CONFIG.captureRetryRetentionHours = 72;
    await queue.enqueueCaptureRetry(unit("in-A"), network, config.CONFIG, T0);
    const space = await createStoredSpace(files, "Retry B");
    await switchStoredSpace(files, space.id);
    refreshConfigIfChanged(project);
    const spaceFolder = join(files.spacesRoot, space.id);
    expect(config.CONFIG.storagePath).toBe(spaceFolder);
    config.CONFIG.captureRetryRetentionHours = 72;

    expect(await queue.countCaptureRetries(config.CONFIG)).toEqual({
      opencode: 0,
      pi: 0,
      "claude-code": 0,
    });
    await queue.enqueueCaptureRetry(unit("in-B", { host: "opencode" }), network, config.CONFIG, T0);
    expect(
      (await queue.listDueCaptureRetries("opencode", config.CONFIG, T0 + HOUR)).map(
        (row) => row.turnId
      )
    ).toEqual(["in-B"]);
    expect(existsSync(join(spaceFolder, "user-prompts.db"))).toBe(true);

    await switchStoredSpace(files, "default");
    refreshConfigIfChanged(project);
    config.CONFIG.captureRetryRetentionHours = 72;
    expect(await queue.countCaptureRetries(config.CONFIG)).toEqual({
      opencode: 0,
      pi: 1,
      "claude-code": 0,
    });
    expect(
      (await queue.listDueCaptureRetries("pi", config.CONFIG, T0 + HOUR)).map((row) => row.turnId)
    ).toEqual(["in-A"]);
  });
});
