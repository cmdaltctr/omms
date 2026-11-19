import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the capture attempt store (storage port slice S1). Real stores in the
// isolated test home; no mocks. The store reads the active storage folder on every call.
const config = await import("../src/config.js");
const { initConfig, refreshConfigIfChanged } = config;
const { saveCaptureAttempt, hasCaptureAttempts, queryCaptureAttempts, lastLiveSaves } =
  await import("../src/services/storage/capture-attempts.js");
const { createStoredSpace, spaceFiles, switchStoredSpace } =
  await import("../src/services/spaces/registry-store.js");

const files = spaceFiles(join(homedir(), ".omms"));
let project: string;
const folders: string[] = [];

const attempt = (host: string, sessionId: string) => ({
  host,
  sourceType: "live-capture",
  sessionId,
  path: null,
  provider: "zai",
  model: "glm",
  stopReason: null,
  blockTypes: ["text"],
  promptChars: 1,
  replyChars: 2,
  durationMs: 3,
  outcome: "saved" as const,
  reason: null,
});

function freshFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "omms-storage-attempts-"));
  folders.push(folder);
  return folder;
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-storage-attempts-project-"));
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

describe("capture attempts storage", () => {
  it("(r) reads rows that a raw client wrote, with the stored column names", async () => {
    const folder = freshFolder();
    config.CONFIG.storagePath = folder;
    const raw = createClient({ url: `file:${join(folder, "user-prompts.db")}` });
    await raw.execute(`CREATE TABLE IF NOT EXISTS capture_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      host TEXT NOT NULL, source_type TEXT NOT NULL, session_id TEXT NOT NULL,
      path TEXT, provider TEXT, model TEXT, stop_reason TEXT, block_types TEXT,
      prompt_chars INTEGER, reply_chars INTEGER, duration_ms INTEGER NOT NULL,
      outcome TEXT NOT NULL, reason TEXT
    )`);
    await raw.execute({
      sql: `INSERT INTO capture_attempts (created_at, host, source_type, session_id, provider, model,
        block_types, duration_ms, outcome, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        1000,
        "pi",
        "live-capture",
        "raw-1",
        "zai",
        "glm",
        '["text"]',
        9,
        "failed",
        "call-error",
      ],
    });
    raw.close();

    const summary = await queryCaptureAttempts(0, 5000);
    expect(summary.recent).toEqual([
      expect.objectContaining({
        timestamp: 1000,
        host: "pi",
        sourceType: "live-capture",
        sessionId: "raw-1",
        blockTypes: ["text"],
        durationMs: 9,
        outcome: "failed",
        reason: "call-error",
      }),
    ]);
    expect(summary.byReason).toEqual([
      { host: "pi", provider: "zai", model: "glm", reason: "call-error", count: 1 },
    ]);
    expect(await hasCaptureAttempts("pi")).toBe(true);
    expect(await hasCaptureAttempts("opencode")).toBe(false);
  });

  it("(w) writes through the API and a raw client sees the same row", async () => {
    const folder = freshFolder();
    config.CONFIG.storagePath = folder;
    await saveCaptureAttempt(attempt("claude-code", "api-1"), 4242);
    const raw = createClient({ url: `file:${join(folder, "user-prompts.db")}` });
    const rows = (await raw.execute("SELECT * FROM capture_attempts")).rows;
    raw.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      created_at: 4242,
      host: "claude-code",
      source_type: "live-capture",
      session_id: "api-1",
      provider: "zai",
      model: "glm",
      block_types: '["text"]',
      prompt_chars: 1,
      reply_chars: 2,
      duration_ms: 3,
      outcome: "saved",
    });
    expect((await lastLiveSaves())["claude-code"]).toBe(4242);
  });

  it("(s) a space switch gives the new space its own rows and leaves the old space unchanged", async () => {
    config.CONFIG.storagePath = join(homedir(), ".omms", "data");
    await saveCaptureAttempt(attempt("pi", "in-A"), 100);
    const space = await createStoredSpace(files, "Attempts B");
    await switchStoredSpace(files, space.id);
    refreshConfigIfChanged(project);
    const spaceFolder = join(files.spacesRoot, space.id);
    expect(config.CONFIG.storagePath).toBe(spaceFolder);

    expect(await hasCaptureAttempts("pi")).toBe(false);
    await saveCaptureAttempt(attempt("opencode", "in-B"), 200);
    expect((await queryCaptureAttempts(0, 1000)).recent.map((row) => row.sessionId)).toEqual([
      "in-B",
    ]);

    await switchStoredSpace(files, "default");
    refreshConfigIfChanged(project);
    expect((await queryCaptureAttempts(0, 1000)).recent.map((row) => row.sessionId)).toEqual([
      "in-A",
    ]);
    expect(await hasCaptureAttempts("opencode")).toBe(false);
  });
});
