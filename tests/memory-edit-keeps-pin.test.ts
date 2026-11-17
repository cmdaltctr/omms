import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const COLUMN_NAMES = [
  "id",
  "content",
  "container_tag",
  "tags",
  "type",
  "created_at",
  "metadata",
  "display_name",
  "user_name",
  "user_email",
  "project_path",
  "project_name",
  "git_repo_url",
  "is_pinned",
];

/** Reads the row as a plain object. A libSQL row also carries numeric keys. */
async function readRow(
  db: { get(sql: string, args: unknown[]): Promise<Record<string, unknown> | null> },
  id: string
): Promise<Record<string, unknown>> {
  const row = await db.get(`SELECT ${COLUMN_NAMES.join(", ")} FROM memories WHERE id = ?`, [id]);
  return Object.fromEntries(COLUMN_NAMES.map((name) => [name, row?.[name]]));
}

describe("editing a memory keeps its pin", () => {
  let baseDir: string;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  async function seedPinnedMemory() {
    baseDir = mkdtempSync(join(tmpdir(), "memory-edit-keeps-pin-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    CONFIG.embeddingDimensions = 768;

    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();

    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");

    const vector = new Float32Array(768);
    vector[0] = 1;
    const scopeHash = "d1d2d3d4e5f67890";
    const containerTag = `opencode_project_${scopeHash}`;
    const shard = await tursoShardManager.createShard("project", scopeHash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const record = {
      id: "mem_pin_edit_1",
      content: "original content",
      vector,
      tagsVector: vector,
      containerTag,
      tags: "alpha,beta",
      type: "decision",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      metadata: JSON.stringify({ source: "test" }),
      displayName: "Display",
      userName: "User",
      userEmail: "user@example.com",
      projectPath: "/work/project",
      projectName: "project",
      gitRepoUrl: "https://example.com/repo.git",
    };
    await tursoVectorSearch.insertVector(db, record);
    await tursoVectorSearch.pinMemory(db, record.id);
    const before = await readRow(db, record.id);
    expect(Number(before.is_pinned)).toBe(1);
    return { db, record, vector, before };
  }

  it("keeps the pin and every other column when the web page edits a memory", async () => {
    const { db, record, vector, before } = await seedPinnedMemory();
    const { handleUpdateMemory } = await import("../src/services/api-handlers.js");
    const { embeddingService } = await import("../src/services/embedding.js");

    const originalWarmup = embeddingService.warmup;
    const originalEmbed = embeddingService.embedWithTimeout;
    embeddingService.warmup = async () => {};
    embeddingService.embedWithTimeout = async () => vector;
    try {
      const result = await handleUpdateMemory(record.id, { content: "edited content" });
      expect(result.success).toBe(true);
    } finally {
      embeddingService.warmup = originalWarmup;
      embeddingService.embedWithTimeout = originalEmbed;
    }

    const after = await readRow(db, record.id);
    expect(after).toEqual({ ...before, content: "edited content" });
  });

  it("keeps the pin when the client replaces a memory row", async () => {
    const { db, record, before } = await seedPinnedMemory();
    const { replaceMemoryRow } = await import("../src/services/memory-replace.js");

    const replaced = await replaceMemoryRow({ ...record, content: "replaced content" });
    expect(replaced).toBe(true);

    const after = await readRow(db, record.id);
    expect(after).toEqual({ ...before, content: "replaced content" });
  });

  it("leaves an unpinned memory unpinned when the client replaces it", async () => {
    const { db, record } = await seedPinnedMemory();
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { replaceMemoryRow } = await import("../src/services/memory-replace.js");
    await tursoVectorSearch.unpinMemory(db, record.id);

    await replaceMemoryRow({ ...record, content: "replaced content" });

    const after = await db.get(`SELECT is_pinned FROM memories WHERE id = ?`, [record.id]);
    expect(Number(after?.is_pinned)).toBe(0);
  });
});
