import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";

/**
 * A copy or move keeps the display fields of a memory: display name, user name, user email,
 * project path, project name and git repository URL. Rows are read back with a raw libsql
 * client, never through the code under test.
 */

const MODEL = "Xenova/nomic-embed-text-v1";
const DIMS = 4;
const PROJECT_TAG = "omms_project_aaaaaaaaaaaaaaaa";

const DISPLAY = {
  display_name: "Display Name One",
  user_name: "Test User",
  user_email: "test.user@example.invalid",
  project_path: "/work/example/project",
  project_name: "Example Project",
  git_repo_url: "https://example.invalid/org/repo.git",
};

async function seedOne(folder: string): Promise<void> {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { openSpaceStore } = await import("../src/services/storage/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    const shard = await store.shards.getWriteShard("project", "aaaaaaaaaaaaaaaa");
    const db = await store.connections.getConnection(shard.dbPath);
    await tursoVectorSearch.insertVector(db, {
      id: "display-one",
      content: "display fields probe",
      vector: new Float32Array([1, 0, 0, 0]),
      containerTag: PROJECT_TAG,
      createdAt: 10_000,
      updatedAt: 10_000,
      displayName: DISPLAY.display_name,
      userName: DISPLAY.user_name,
      userEmail: DISPLAY.user_email,
      projectPath: DISPLAY.project_path,
      projectName: DISPLAY.project_name,
      gitRepoUrl: DISPLAY.git_repo_url,
    });
    await store.shards.incrementVectorCount(shard.id);
  } finally {
    await store.close();
  }
}

/** The display columns of the one row in the target's project shard, read raw. */
async function targetDisplayRow(folder: string): Promise<Record<string, unknown>> {
  const metadata = createClient({ url: `file:${join(folder, "metadata.db")}` });
  try {
    const shards = await metadata.execute(`SELECT scope, db_path FROM shards`);
    expect(shards.rows).toHaveLength(1);
    const file = join(folder, "projects", String(shards.rows[0]!.db_path).split(/[\\/]/).pop()!);
    const shard = createClient({ url: `file:${file}` });
    try {
      const result = await shard.execute(
        `SELECT display_name, user_name, user_email, project_path, project_name, git_repo_url
           FROM memories WHERE id = 'display-one'`
      );
      return { ...result.rows[0] };
    } finally {
      shard.close();
    }
  } finally {
    metadata.close();
  }
}

describe("space transfer keeps the display fields", () => {
  let tmp = "";
  let alpha = "";
  let beta = "";

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "space-display-"));
    alpha = join(tmp, "spaces", "alpha");
    beta = join(tmp, "spaces", "beta");
    mkdirSync(alpha, { recursive: true });
    mkdirSync(beta, { recursive: true });
    writeFileSync(
      join(tmp, "spaces.json"),
      JSON.stringify({
        version: 1,
        activeSpaceId: "default",
        spaces: [
          { id: "alpha", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z", archived: false },
          { id: "beta", name: "Beta", createdAt: "2026-01-02T00:00:00.000Z", archived: false },
        ],
      })
    );
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(tmp, "default-store");
    CONFIG.embeddingModel = MODEL;
    CONFIG.embeddingDimensions = DIMS;
    await seedOne(alpha);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory();
    if (tmp) await removeTestDir(tmp);
  });

  async function apply(mode: "copy" | "move") {
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    const { applySpaceTransfer } = await import("../src/services/spaces/transfer-service.js");
    return applySpaceTransfer(
      { from: "alpha", to: "beta", filter: { since: 0, until: 40_000 }, mode },
      {
        files: spaceFiles(tmp),
        paths: { globalStoragePath: join(tmp, "default-store"), spacesRoot: join(tmp, "spaces") },
        embedding: { model: MODEL, dimensions: DIMS },
        maxVectorsPerShard: 100,
        embed: async () => new Float32Array([0, 1, 0, 0]),
      }
    );
  }

  it("a copy writes every display field to the target row", async () => {
    expect(await apply("copy")).toMatchObject({ ok: true, result: { ok: true, copied: 1 } });
    expect(await targetDisplayRow(beta)).toEqual(DISPLAY);
  });

  it("a move writes every display field to the target row", async () => {
    expect(await apply("move")).toMatchObject({
      ok: true,
      result: { ok: true, copied: 1, removed: 1 },
    });
    expect(await targetDisplayRow(beta)).toEqual(DISPLAY);
  });
});
