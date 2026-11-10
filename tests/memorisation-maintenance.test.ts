import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const tempDirs: string[] = [];
let baseDir: string | undefined;

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
  baseDir = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function createProjectShard() {
  baseDir = mkdtempSync(join(tmpdir(), "omms-memorisation-maintenance-"));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  CONFIG.embeddingDimensions = 8;
  const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
  await closeTursoAndInvalidateCaches();
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const scopeHash = "a1b2c3d4e5f60718";
  const shard = await tursoShardManager.createShard("project", scopeHash, 0);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  const vector = new Float32Array(8);
  vector[0] = 1;
  const containerTag = `omms_project_${scopeHash}`;
  return { CONFIG, db, tursoVectorSearch, containerTag, vector };
}

describe("memorisation maintenance", () => {
  it("keeps two identical memorisations during duplicate removal", async () => {
    const { CONFIG, db, tursoVectorSearch, containerTag, vector } = await createProjectShard();
    CONFIG.deduplicationEnabled = true;
    const now = Date.now();
    for (const [id, type, createdAt] of [
      ["normal-old", "discussion", now - 1],
      ["normal-new", "discussion", now],
      ["ms-old01", "memorisation", now - 1],
      ["ms-new01", "memorisation", now],
    ] as const) {
      await tursoVectorSearch.insertVector(db, {
        id,
        content: id.startsWith("ms-") ? "same snapshot" : "same ordinary memory",
        vector,
        containerTag,
        type,
        tags: type === "memorisation" ? "memorisation" : undefined,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const { deduplicationService } = await import("../src/services/deduplication-service.js");
    const result = await deduplicationService.detectAndRemoveDuplicates();
    const rows = await db.all("SELECT id FROM memories ORDER BY id");

    expect(result.exactDuplicatesDeleted).toBe(1);
    expect(rows.map((row) => row.id)).toEqual(["ms-new01", "ms-old01", "normal-new"]);
  });

  it("keeps an old memorisation during retention cleanup", async () => {
    const { CONFIG, db, tursoVectorSearch, containerTag, vector } = await createProjectShard();
    CONFIG.autoCleanupRetentionDays = 30;
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    for (const [id, type] of [
      ["normal-old", "discussion"],
      ["ms-old01", "memorisation"],
    ] as const) {
      await tursoVectorSearch.insertVector(db, {
        id,
        content: id,
        vector,
        containerTag,
        type,
        tags: type === "memorisation" ? "memorisation" : undefined,
        createdAt: old,
        updatedAt: old,
      });
    }

    const { CleanupService } = await import("../src/services/cleanup-service.js");
    const result = await new CleanupService().runCleanup();
    const rows = await db.all("SELECT id FROM memories");

    expect(result.deletedCount).toBe(1);
    expect(rows.map((row) => row.id)).toEqual(["ms-old01"]);
  });

  it("skips untagged memorisations during AI tag backfill", async () => {
    const { CONFIG, db, tursoVectorSearch, containerTag, vector } = await createProjectShard();
    Object.assign(CONFIG, {
      memoryProvider: "openai-chat",
      memoryModel: "test-model",
      memoryApiUrl: "https://example.invalid/v1",
      memoryApiKey: "test-key",
    });
    const now = Date.now();
    for (const [id, type] of [
      ["normal-untagged", "discussion"],
      ["ms-untagged", "memorisation"],
    ] as const) {
      await tursoVectorSearch.insertVector(db, {
        id,
        content: id,
        vector,
        containerTag,
        type,
        createdAt: now,
        updatedAt: now,
      });
    }

    const { embeddingService } = await import("../src/services/embedding.js");
    const { AIProviderFactory } = await import("../src/services/ai/ai-provider-factory.js");
    const originalEmbed = embeddingService.embedWithTimeout;
    const originalCreate = AIProviderFactory.createProvider;
    const modelCalls: string[] = [];
    embeddingService.embedWithTimeout = (async () => vector) as typeof originalEmbed;
    AIProviderFactory.createProvider = (() => ({
      executeToolCall: async (_system: string, prompt: string) => {
        modelCalls.push(prompt);
        return { success: true, data: { tags: ["generated"] } };
      },
    })) as unknown as typeof originalCreate;

    try {
      const { handleDetectTagMigration, handleRunTagMigrationBatch } =
        await import("../src/services/api-handlers.js");
      expect((await handleDetectTagMigration()).data).toEqual({ needsMigration: true, count: 1 });
      expect((await handleRunTagMigrationBatch(5)).data).toEqual({
        processed: 1,
        total: 1,
        hasMore: false,
      });
      const rows = await db.all("SELECT id, tags FROM memories ORDER BY id");
      expect(rows.map((row) => [row.id, row.tags])).toEqual([
        ["ms-untagged", null],
        ["normal-untagged", "generated"],
      ]);
      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]).toContain("normal-untagged");
      expect(modelCalls[0]).not.toContain("ms-untagged");
    } finally {
      embeddingService.embedWithTimeout = originalEmbed;
      AIProviderFactory.createProvider = originalCreate;
    }
  });

  it("requests normal memories for capture context and excludes the latest memorisation", () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-memorisation-capture-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "scenario.test.ts");
    const url = (path: string) => new URL(path, import.meta.url).href;
    const script = `
import { expect, it, mock } from "bun:test";
const listCalls = [];
let captureContext = "";
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({
  CONFIG: {},
  refreshConfigIfChanged: () => {},
}));
mock.module(${JSON.stringify(url("../src/services/capture-diagnostics.js"))}, () => ({
  buildCaptureAttemptRecord: () => ({}),
  emitCaptureAttempt: () => {},
}));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({
  getTags: () => ({ project: { tag: "omms_project_test", displayName: "test" } }),
}));
mock.module(${JSON.stringify(url("../src/services/client.js"))}, () => ({
  memoryClient: {
    listMemories: async (...args) => {
      listCalls.push(args);
      const normalOnly = args[3]?.kind === "normal";
      return {
        success: true,
        memories: [{ summary: normalOnly ? "older normal memory" : "latest memorisation" }],
      };
    },
    addMemory: async () => ({ success: true, id: "mem-new" }),
  },
}));
const { captureConversation } = await import(${JSON.stringify(url("../src/core/capture.js"))});
it("excludes memorisations from capture context", async () => {
await captureConversation(
  {
    host: "pi",
    hostSessionId: "session-1",
    sourceType: "live-capture",
    projectDirectory: "/workspace",
    userPrompt: "Continue the work",
    textResponses: ["Working on it"],
    toolCalls: [],
  },
  {
    summarize: async ({ context }) => {
      captureContext = context;
      return { summary: "", type: "skip", tags: [] };
    },
  }
);
console.log(JSON.stringify({ listCalls, captureContext }));
expect(captureContext).toContain("older normal memory");
});
`;
    writeFileSync(scriptPath, script);
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", scriptPath],
      cwd: dir,
      env: { ...process.env, OMMS_REAL_HOME: process.env.HOME },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = Buffer.from(result.stdout).toString("utf8");
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    expect(result.exitCode, `${stdout}\n${stderr}`).toBe(0);
    const scenarioLine = stdout
      .trim()
      .split("\n")
      .find((line) => line.startsWith('{"listCalls"'));
    expect(scenarioLine).toBeDefined();
    const scenario = JSON.parse(scenarioLine!) as {
      listCalls: unknown[][];
      captureContext: string;
    };
    expect(scenario.listCalls).toEqual([["omms_project_test", 1, "project", { kind: "normal" }]]);
    expect(scenario.captureContext).toContain("older normal memory");
    expect(scenario.captureContext).not.toContain("latest memorisation");
  });
});
