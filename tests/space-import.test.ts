import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";
import type { SpaceFiles } from "../src/services/spaces/registry-store.js";

const HASH_A = "a1b2c3d4e5f60718";
const HASH_B = "b2c3d4e5f6071829";
const USER_HASH_IMPORT = "1122334455667788";
const PROJECT_TAG_A = `omms_project_${HASH_A}`;
const PROJECT_TAG_B = `omms_project_${HASH_B}`;
const USER_TAG_IMPORT = `omms_user_${USER_HASH_IMPORT}`;
const DIMS = 4;
const NEW_SPACE = "From Sam";

/**
 * Deterministic stand-in for the embedding service: tokens hash into a fixed
 * number of dimensions, so texts that share words land near each other and a
 * search by meaning works without downloading a model.
 */
function fakeEmbedder(dims: number): (text: string) => Promise<Float32Array> {
  return async (text) => {
    const vector = new Float32Array(dims);
    for (const token of text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)) {
      let bucket = 0;
      for (let i = 0; i < token.length; i++) {
        bucket = (bucket * 31 + token.charCodeAt(i)) % dims;
      }
      vector[bucket] += 1;
    }
    let sum = 0;
    for (const value of vector) sum += value * value;
    if (sum === 0) {
      vector[0] = 1;
    } else {
      const scale = Math.sqrt(sum);
      for (let i = 0; i < dims; i++) vector[i] /= scale;
    }
    return vector;
  };
}

function exportMemory(over: Record<string, unknown> & { id: string }): Record<string, unknown> {
  return {
    content: `content of ${over.id}`,
    scope: "project",
    projectTag: PROJECT_TAG_A,
    createdAt: 100,
    updatedAt: 100,
    isPinned: false,
    ...over,
  };
}

function exportDocument(
  memories: Array<Record<string, unknown>>,
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    format: "omms-space-export",
    schemaVersion: 1,
    exportedAt: "2026-11-06T00:00:00.000Z",
    ommsVersion: "9.9.9-test",
    embedding: { model: "test-embed", dimensions: DIMS },
    memories,
    ...over,
  };
}

let ommsDir = "";
const extraDirs: string[] = [];

/** A fresh OMMS folder with CONFIG pointed at it, so global managers allow its files. */
async function prepare(label: string): Promise<SpaceFiles> {
  ommsDir = mkdtempSync(join(tmpdir(), `space-import-${label}-`));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = ommsDir;
  CONFIG.embeddingDimensions = DIMS;
  const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
  return spaceFiles(ommsDir);
}

interface ImportCall {
  document?: unknown;
  filePath?: string;
  spaceName?: string;
  retagToProject?: string;
  embedding?: { model: string; dimensions: number };
  maxFileBytes?: number;
  embed?: (text: string) => Promise<Float32Array>;
}

async function runImport(files: SpaceFiles, call: ImportCall) {
  const { importSpace } = await import("../src/services/spaces/import-space.js");
  return importSpace({
    files,
    spaceName: call.spaceName ?? NEW_SPACE,
    ...(call.document !== undefined ? { document: call.document } : {}),
    ...(call.filePath !== undefined ? { filePath: call.filePath } : {}),
    ...(call.retagToProject !== undefined ? { retagToProject: call.retagToProject } : {}),
    embedding: call.embedding ?? { model: "test-embed", dimensions: DIMS },
    embed: call.embed ?? fakeEmbedder(DIMS),
    user: {
      userTag: USER_TAG_IMPORT,
      displayName: "Sam Importer",
      userName: "sam",
      userEmail: "sam@example.org",
    },
    ...(call.maxFileBytes !== undefined ? { maxFileBytes: call.maxFileBytes } : {}),
  });
}

/** Every memory row of a space folder, read through the space read store. */
async function readRows(folder: string): Promise<Array<Record<string, unknown>>> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "read");
  try {
    const rows: Array<Record<string, unknown>> = [];
    for (const scope of ["project", "user"] as const) {
      for (const shard of await store.listShards(scope, "")) {
        const db = await store.openShard(shard.dbPath);
        rows.push(
          ...(await db.all(
            `SELECT id, content, container_tag, tags, type, metadata, is_pinned,
                    length(vector) AS vector_bytes,
                    tags_vector IS NOT NULL AS has_tags_vector
               FROM memories`
          ))
        );
      }
    }
    return rows;
  } finally {
    await store.close();
  }
}

function registrySnapshot(files: SpaceFiles): string {
  if (!existsSync(files.registryPath)) return "<no registry>";
  return readFileSync(files.registryPath, "utf-8");
}

function spaceFolders(files: SpaceFiles): string[] {
  if (!existsSync(files.spacesRoot)) return [];
  return readdirSync(files.spacesRoot).sort();
}

/** SHA-256 of every file under `folder`, keyed by its path relative to the folder. */
function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        hashes.set(
          relative(folder, full),
          createHash("sha256").update(readFileSync(full)).digest("hex")
        );
      }
    }
  };
  walk(folder);
  return hashes;
}

/** Writes a learned profile into a space folder through a rooted manager. */
async function seedProfile(folder: string): Promise<void> {
  const { TursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  const connections = new TursoConnectionManager(createClient, () => [folder]);
  try {
    const manager = new UserProfileManager(folder, connections);
    await manager.createProfile(
      "user-jo",
      "Jo Exporter",
      "jo",
      "jo@example.org",
      {
        preferences: [
          {
            category: "Tooling",
            description: "Prefers Vitest over Jest",
            confidence: 0.9,
            frequency: 4,
            evidence: [],
            lastSeen: 200,
            firstSeen: 100,
          },
        ],
        patterns: [
          {
            category: "Style",
            description: "Writes short functions",
            confidence: 0.8,
            frequency: 2,
            evidence: [],
            lastSeen: 210,
          },
        ],
        workflows: [
          {
            description: "Ship checklist",
            steps: ["run tests", "bump the version", "tag the release"],
            confidence: 0.7,
            frequency: 1,
            evidence: [],
            lastSeen: 220,
          },
        ],
      },
      12
    );
  } finally {
    await connections.closeAll();
  }
}

/** Writes one project memory into a space folder through a write store. */
async function seedOneMemory(folder: string, id: string, hash: string = HASH_A): Promise<void> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const store = openSpaceStore(folder, "write");
  try {
    const shard = await store.shards.getWriteShard("project", hash);
    const db = await store.connections.getConnection(shard.dbPath);
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `keeper lesson of ${id}`,
      vector: new Float32Array([1, 0, 0, 0]),
      containerTag: `omms_project_${hash}`,
      createdAt: 100,
      updatedAt: 100,
    });
    await store.shards.incrementVectorCount(shard.id);
  } finally {
    await store.close();
  }
}

afterEach(async () => {
  await cleanupTursoTestDirectory(ommsDir);
  if (ommsDir) await removeTestDir(ommsDir);
  for (const dir of extraDirs.splice(0)) await removeTestDir(dir);
  ommsDir = "";
});

describe("space import validation (7.1)", () => {
  it("refuses a taken name and changes nothing", async () => {
    const files = await prepare("taken");
    const { createStoredSpace } = await import("../src/services/spaces/registry-store.js");
    await createStoredSpace(files, NEW_SPACE);
    const registryBefore = registrySnapshot(files);
    const foldersBefore = spaceFolders(files);

    const result = await runImport(files, {
      document: exportDocument([exportMemory({ id: "taken_1" })]),
    });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/already exists/i);
    expect(registrySnapshot(files)).toBe(registryBefore);
    expect(spaceFolders(files)).toEqual(foldersBefore);
  });

  it("refuses a missing retag folder before any space exists", async () => {
    const files = await prepare("nofolder");
    const registryBefore = registrySnapshot(files);

    const result = await runImport(files, {
      document: exportDocument([exportMemory({ id: "nofolder_1" })]),
      retagToProject: join(ommsDir, "does-not-exist"),
    });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/does not exist/i);
    expect(registrySnapshot(files)).toBe(registryBefore);
    expect(spaceFolders(files)).toEqual([]);
  });

  it("refuses a file that is not JSON and creates no space", async () => {
    const files = await prepare("notjson");
    const badPath = join(ommsDir, "not-json.txt");
    writeFileSync(badPath, "this is not json {", "utf-8");

    const result = await runImport(files, { filePath: badPath });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/not valid JSON/i);
    expect(spaceFolders(files)).toEqual([]);
  });

  it("refuses a schema-invalid file and creates no space", async () => {
    const files = await prepare("badschema");
    const result = await runImport(files, {
      document: exportDocument([exportMemory({ id: "bad_1" })], { memories: "nope" }),
    });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/schema/i);
    expect(spaceFolders(files)).toEqual([]);
    expect(registrySnapshot(files)).toBe("<no registry>");
  });

  it("refuses a newer schema version and says to upgrade OMMS", async () => {
    const files = await prepare("newer");
    const result = await runImport(files, {
      document: exportDocument([exportMemory({ id: "newer_1" })], { schemaVersion: 2 }),
    });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/upgrade OMMS/i);
    expect(spaceFolders(files)).toEqual([]);
  });

  it("refuses an oversized file and the default cap is 100 MB", async () => {
    const files = await prepare("oversize");
    const path = join(ommsDir, "big.json");
    writeFileSync(path, JSON.stringify(exportDocument([exportMemory({ id: "big_1" })])), "utf-8");

    const result = await runImport(files, { filePath: path, maxFileBytes: 4 });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/larger than the import limit/i);
    expect(spaceFolders(files)).toEqual([]);

    const { IMPORT_MAX_FILE_BYTES } = await import("../src/services/spaces/import-space.js");
    expect(IMPORT_MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe("space import into a new space (7.1)", () => {
  it("keeps the file's project tags by default and retags user scope to the importing user", async () => {
    const files = await prepare("default-tags");
    const result = await runImport(files, {
      document: exportDocument([
        exportMemory({
          id: "keep_a",
          content: "lesson of project a",
          tags: ["vue", "testing"],
          type: "note",
          isPinned: true,
          metadata: { count: 3 },
        }),
        exportMemory({ id: "keep_b", content: "lesson of project b", projectTag: PROJECT_TAG_B }),
        {
          id: "keep_user",
          content: "personal lesson",
          scope: "user",
          createdAt: 150,
          updatedAt: 150,
          isPinned: false,
        },
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.spaceName).toBe(NEW_SPACE);
    expect(result.counts.projectMemories).toBe(2);
    expect(result.counts.userMemories).toBe(1);
    expect(result.counts.fileProjects).toBe(2);

    const rows = await readRows(join(files.spacesRoot, result.spaceId!));
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((row) => [String(row.id), row]));

    expect(String(byId.get("keep_a")!.container_tag)).toBe(PROJECT_TAG_A);
    expect(String(byId.get("keep_b")!.container_tag)).toBe(PROJECT_TAG_B);
    expect(String(byId.get("keep_user")!.container_tag)).toBe(USER_TAG_IMPORT);
    expect(Number(byId.get("keep_a")!.is_pinned)).toBe(1);
    expect(Number(byId.get("keep_user")!.is_pinned)).toBe(0);
    expect(String(byId.get("keep_a")!.tags)).toBe("vue,testing");
    expect(byId.get("keep_a")!.type).toBe("note");
    expect(JSON.parse(String(byId.get("keep_a")!.metadata))).toEqual({ count: 3 });
  });

  it("retags every project memory to the given folder and leaves user scope alone", async () => {
    const files = await prepare("retag");
    const retagFolder = mkdtempSync(join(tmpdir(), "space-import-retag-"));
    extraDirs.push(retagFolder);
    const { getProjectTagInfo } = await import("../src/services/tags.js");
    const { extractScopeFromContainerTag } = await import("../src/services/memory-scope.js");
    const expectedTag = getProjectTagInfo(retagFolder).tag;
    const { hash } = extractScopeFromContainerTag(expectedTag);

    const result = await runImport(files, {
      document: exportDocument([
        exportMemory({ id: "retag_a", content: "lesson of project a" }),
        exportMemory({ id: "retag_b", content: "lesson of project b", projectTag: PROJECT_TAG_B }),
        {
          id: "retag_user",
          content: "personal lesson",
          scope: "user",
          createdAt: 150,
          updatedAt: 150,
          isPinned: false,
        },
      ]),
      retagToProject: retagFolder,
    });

    expect(result.ok).toBe(true);
    expect(result.counts.fileProjects).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/merged onto one project/i);

    const folder = join(files.spacesRoot, result.spaceId!);
    const rows = await readRows(folder);
    const projectRows = rows.filter(
      (row) => String(row.id).startsWith("retag_a") || row.id === "retag_b"
    );
    expect(projectRows).toHaveLength(2);
    for (const row of projectRows) {
      expect(String(row.container_tag)).toBe(expectedTag);
    }
    const userRow = rows.find((row) => row.id === "retag_user")!;
    expect(String(userRow.container_tag)).toBe(USER_TAG_IMPORT);

    // Every retagged memory sits in the one shard of that folder's scope hash.
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const store = openSpaceStore(folder, "read");
    try {
      const shards = await store.listShards("project", hash);
      expect(shards).toHaveLength(1);
      const db = await store.openShard(shards[0]!.dbPath);
      const ids = (await db.all(`SELECT id FROM memories`)).map((row) => String(row.id)).sort();
      expect(ids).toEqual(["retag_a", "retag_b"]);
    } finally {
      await store.close();
    }
  });

  it("embeds every memory and its tags with the current model", async () => {
    const files = await prepare("vectors");
    const embedTexts: string[] = [];
    const embed = async (text: string): Promise<Float32Array> => {
      embedTexts.push(text);
      return fakeEmbedder(DIMS)(text);
    };

    const result = await runImport(files, {
      document: exportDocument([
        exportMemory({ id: "vec_tagged", content: "tagged lesson", tags: ["tooling"] }),
        exportMemory({ id: "vec_plain", content: "plain lesson" }),
      ]),
      embed,
    });

    expect(result.ok).toBe(true);
    expect(embedTexts).toContain("tagged lesson");
    expect(embedTexts).toContain("Topics: tooling");
    expect(embedTexts).toContain("plain lesson");

    const rows = await readRows(join(files.spacesRoot, result.spaceId!));
    for (const row of rows) {
      // vector32 stores one 4-byte float per dimension.
      expect(Number(row.vector_bytes)).toBe(DIMS * 4);
    }
    const tagged = rows.find((row) => row.id === "vec_tagged")!;
    expect(Number(tagged.has_tags_vector)).toBe(1);
    const plain = rows.find((row) => row.id === "vec_plain")!;
    expect(Number(plain.has_tags_vector)).toBe(0);
  });

  it("gives no model warning when the file's model matches the settings", async () => {
    const files = await prepare("match");
    const result = await runImport(files, {
      document: exportDocument([exportMemory({ id: "match_1" })]),
    });
    expect(result.ok).toBe(true);
    // The machine-local tags note (design D7) may be present; the model warning may not.
    expect(result.warnings.join(" ")).not.toMatch(/embedded with/);
  });

  it("warns naming both models when they differ, and still imports", async () => {
    const files = await prepare("mismatch");
    const modelDiffers = await runImport(files, {
      document: exportDocument([exportMemory({ id: "mismatch_model" })], {
        embedding: { model: "model-a", dimensions: DIMS },
      }),
      embedding: { model: "model-b", dimensions: DIMS },
    });
    expect(modelDiffers.ok).toBe(true);
    expect(modelDiffers.warnings.join(" ")).toMatch(/model-a/);
    expect(modelDiffers.warnings.join(" ")).toMatch(/model-b/);

    const dimsDiffers = await runImport(files, {
      document: exportDocument([exportMemory({ id: "mismatch_dims" })], {
        embedding: { model: "test-embed", dimensions: 768 },
      }),
      spaceName: "Dims Differ",
    });
    expect(dimsDiffers.ok).toBe(true);
    expect(dimsDiffers.warnings.join(" ")).toMatch(/768/);
    expect(dimsDiffers.warnings.join(" ")).toMatch(/\b4\b/);
  });

  it("leaves the active space unchanged", async () => {
    const files = await prepare("active");
    const before = JSON.parse(
      registrySnapshot(files) === "<no registry>" ? "{}" : registrySnapshot(files)
    ) as {
      activeSpaceId?: string;
    };

    const result = await runImport(files, {
      document: exportDocument([exportMemory({ id: "active_1" })]),
    });

    expect(result.ok).toBe(true);
    const after = JSON.parse(readFileSync(files.registryPath, "utf-8")) as {
      activeSpaceId: string;
      spaces: Array<{ id: string }>;
    };
    expect(after.activeSpaceId).toBe(before.activeSpaceId ?? "default");
    expect(after.spaces.map((space) => space.id)).toEqual([result.spaceId]);
  });
});

describe("space import failure path (7.2)", () => {
  it("removes the new registry entry and folder and leaves every other space byte-identical", async () => {
    const files = await prepare("failure");
    const { createStoredSpace } = await import("../src/services/spaces/registry-store.js");
    const keeper = await createStoredSpace(files, "Keeper");
    const keeperFolder = join(files.spacesRoot, keeper.id);
    await seedOneMemory(keeperFolder, "keeper_one");

    const keeperBefore = hashFolder(keeperFolder);
    expect(keeperBefore.size).toBeGreaterThan(0);
    const registryBefore = registrySnapshot(files);

    let calls = 0;
    const embed = async (text: string): Promise<Float32Array> => {
      calls++;
      if (calls === 2) throw new Error("embedding exploded");
      return fakeEmbedder(DIMS)(text);
    };

    const result = await runImport(files, {
      document: exportDocument([
        exportMemory({ id: "fail_1", content: "first lesson" }),
        exportMemory({ id: "fail_2", content: "second lesson" }),
      ]),
      embed,
    });

    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/embedding exploded/);
    expect(result.reason ?? "").toMatch(/removed/);
    expect(calls).toBeGreaterThanOrEqual(2);

    expect(registrySnapshot(files)).toBe(registryBefore);
    expect(hashFolder(keeperFolder)).toEqual(keeperBefore);
    expect(spaceFolders(files)).toEqual([keeper.id]);
  });
});

describe("space export and import round trip (7.3)", () => {
  it("restores the count, scrubbed texts, project tags and profile, and search finds by meaning", async () => {
    const files = await prepare("roundtrip");
    const spaceA = mkdtempSync(join(tmpdir(), "space-import-source-"));
    extraDirs.push(spaceA);
    const outDir = mkdtempSync(join(tmpdir(), "space-import-out-"));
    extraDirs.push(outDir);

    // Seed space A: two projects, one user-scope memory with private-ish text, one profile.
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const seed = await openSpaceStore(spaceA, "write");
    try {
      const seeds = [
        {
          id: "rt_one",
          content: "use bun test to run the workspace checks",
          tag: PROJECT_TAG_A,
          hash: HASH_A,
          tags: "tooling",
        },
        {
          id: "rt_two",
          content: "the config is in /Users/jo/work/app/config.json",
          tag: PROJECT_TAG_A,
          hash: HASH_A,
          tags: undefined,
        },
        {
          id: "rt_three",
          content: "second project lesson",
          tag: PROJECT_TAG_B,
          hash: HASH_B,
          tags: undefined,
        },
      ];
      for (const item of seeds) {
        const shard = await seed.shards.getWriteShard("project", item.hash);
        const db = await seed.connections.getConnection(shard.dbPath);
        await tursoVectorSearch.insertVector(db, {
          id: item.id,
          content: item.content,
          vector: new Float32Array([1, 0, 0, 0]),
          containerTag: item.tag,
          ...(item.tags ? { tags: item.tags } : {}),
          createdAt: 100,
          updatedAt: 100,
        });
        await seed.shards.incrementVectorCount(shard.id);
      }
      // A user-scope memory of the exporting user: import must retag it.
      const userShard = await seed.shards.getWriteShard("user", "9988776655443322");
      const userDb = await seed.connections.getConnection(userShard.dbPath);
      await tursoVectorSearch.insertVector(userDb, {
        id: "rt_user",
        content: "personal note about /Users/jo/keys",
        vector: new Float32Array([1, 0, 0, 0]),
        containerTag: "omms_user_9988776655443322",
        createdAt: 150,
        updatedAt: 150,
      });
      await seed.shards.incrementVectorCount(userShard.id);
    } finally {
      await seed.close();
    }
    await seedProfile(spaceA);

    // Export with the opt-in so the user-scope memory and profile travel.
    const { exportSpace } = await import("../src/services/spaces/export-space.js");
    const outPath = join(outDir, "round-trip.json");
    const exported = await exportSpace({
      folder: spaceA,
      outPath,
      includeProfile: true,
      embeddingModel: "test-embed",
      embeddingDimensions: DIMS,
      ommsVersion: "9.9.9-test",
      homePath: "/Users/jo",
    });
    expect(exported.written).toBe(true);
    expect(exported.counts.projectMemories).toBe(3);

    // Import as space B with default settings.
    const result = await runImport(files, { filePath: outPath, spaceName: "Round Trip" });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).not.toMatch(/model-a/);

    const folderB = join(files.spacesRoot, result.spaceId!);
    const rows = await readRows(folderB);
    expect(rows).toHaveLength(4);

    const texts = rows.map((row) => String(row.content)).sort();
    expect(texts).toEqual(
      [
        "personal note about ~/keys",
        "second project lesson",
        "the config is in ~/work/app/config.json",
        "use bun test to run the workspace checks",
      ].sort()
    );

    const byId = new Map(rows.map((row) => [String(row.id), row]));
    expect(String(byId.get("rt_one")!.container_tag)).toBe(PROJECT_TAG_A);
    expect(String(byId.get("rt_two")!.container_tag)).toBe(PROJECT_TAG_A);
    expect(String(byId.get("rt_three")!.container_tag)).toBe(PROJECT_TAG_B);
    expect(String(byId.get("rt_user")!.container_tag)).toBe(USER_TAG_IMPORT);

    // The profile was written through a manager rooted at the new folder.
    const { TursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { UserProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const profileConnections = new TursoConnectionManager(createClient, () => [folderB]);
    try {
      const manager = new UserProfileManager(folderB, profileConnections);
      const profile = await manager.getActiveProfile("sam@example.org");
      expect(profile).not.toBeNull();
      const data = JSON.parse(profile!.profileData) as {
        preferences: Array<{ description: string; category: string }>;
        patterns: Array<{ description: string }>;
        workflows: Array<{ description: string; steps: string[] }>;
      };
      expect(data.preferences).toHaveLength(1);
      expect(data.preferences[0]!.description).toBe("Prefers Vitest over Jest");
      expect(data.preferences[0]!.category).toBe("Tooling");
      expect(data.patterns[0]!.description).toBe("Writes short functions");
      expect(data.workflows[0]!.steps).toEqual([
        "run tests",
        "bump the version",
        "tag the release",
      ]);
    } finally {
      await profileConnections.closeAll();
    }

    // A search in B finds a memory by meaning, through the real shard search.
    const { tursoVectorSearch: search } = await import("../src/services/turso/vector-search.js");
    const readB = await openSpaceStore(folderB, "read");
    try {
      const shards = await readB.listShards("project", HASH_A);
      expect(shards).toHaveLength(1);
      const queryVector = await fakeEmbedder(DIMS)("run the workspace checks with bun test");
      const { results } = await search.searchAcrossShards(
        shards,
        queryVector,
        PROJECT_TAG_A,
        5,
        0.3
      );
      expect(results.map((hit) => hit.id)).toContain("rt_one");
      expect(results[0]!.id).toBe("rt_one");
      expect(results[0]!.similarity).toBeGreaterThan(0.3);
    } finally {
      await readB.close();
    }
  });

  it("a retag round trip lets a project-scope search from that folder find every project memory", async () => {
    const files = await prepare("roundtrip-retag");
    const spaceA = mkdtempSync(join(tmpdir(), "space-import-source2-"));
    extraDirs.push(spaceA);
    const outDir = mkdtempSync(join(tmpdir(), "space-import-out2-"));
    extraDirs.push(outDir);
    const retagFolder = mkdtempSync(join(tmpdir(), "space-import-retag2-"));
    extraDirs.push(retagFolder);

    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const seed = await openSpaceStore(spaceA, "write");
    try {
      const seeds = [
        { id: "mr_one", content: "deploy checklist lesson", hash: HASH_A },
        { id: "mr_two", content: "database migration lesson", hash: HASH_A },
        { id: "mr_three", content: "release tagging lesson", hash: HASH_B },
      ];
      for (const item of seeds) {
        const shard = await seed.shards.getWriteShard("project", item.hash);
        const db = await seed.connections.getConnection(shard.dbPath);
        await tursoVectorSearch.insertVector(db, {
          id: item.id,
          content: item.content,
          vector: new Float32Array([1, 0, 0, 0]),
          containerTag: `omms_project_${item.hash}`,
          createdAt: 100,
          updatedAt: 100,
        });
        await seed.shards.incrementVectorCount(shard.id);
      }
    } finally {
      await seed.close();
    }

    const { exportSpace } = await import("../src/services/spaces/export-space.js");
    const outPath = join(outDir, "retag.json");
    const exported = await exportSpace({
      folder: spaceA,
      outPath,
      embeddingModel: "test-embed",
      embeddingDimensions: DIMS,
      ommsVersion: "9.9.9-test",
      homePath: "/Users/jo",
    });
    expect(exported.written).toBe(true);

    const result = await runImport(files, {
      filePath: outPath,
      spaceName: "Merged",
      retagToProject: retagFolder,
    });
    expect(result.ok).toBe(true);

    const { getProjectTagInfo } = await import("../src/services/tags.js");
    const { extractScopeFromContainerTag } = await import("../src/services/memory-scope.js");
    const expectedTag = getProjectTagInfo(retagFolder).tag;
    const { hash } = extractScopeFromContainerTag(expectedTag);

    const folder = join(files.spacesRoot, result.spaceId!);
    const rows = await readRows(folder);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(String(row.container_tag)).toBe(expectedTag);
    }

    const readStore = await openSpaceStore(folder, "read");
    try {
      const shards = await readStore.listShards("project", hash);
      expect(shards).toHaveLength(1);
      const queryVector = await fakeEmbedder(DIMS)("anything about this project");
      const { results } = await tursoVectorSearch.searchAcrossShards(
        shards,
        queryVector,
        expectedTag,
        10,
        0
      );
      expect(results.map((hit) => hit.id).sort()).toEqual(["mr_one", "mr_three", "mr_two"]);
    } finally {
      await readStore.close();
    }
  });
});
