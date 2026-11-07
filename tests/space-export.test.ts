import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";
import type { ExportSpaceOptions } from "../src/services/spaces/export-space.js";

const HASH = "a1b2c3d4e5f60718";
const USER_HASH = "1122334455667788";
const PROJECT_TAG = `omms_project_${HASH}`;
const USER_TAG = `omms_user_${USER_HASH}`;
const HOME = "/Users/qa";

/** Keys that must appear nowhere in an export file: vectors and identity fields. */
const FORBIDDEN_KEYS = [
  "vector",
  "tags_vector",
  "centroid",
  "anchor",
  "displayName",
  "userName",
  "userEmail",
  "projectPath",
  "projectName",
  "gitRepoUrl",
];

/** SHA-256 of every file under `folder`, keyed by its path relative to the folder. */
function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
        hashes.set(relative(folder, full), digest);
      }
    }
  };
  walk(folder);
  return hashes;
}

interface SeedMemory {
  id: string;
  content: string;
  containerTag?: string;
  tags?: string;
  type?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  pinned?: boolean;
}

/** A fresh space folder with CONFIG pointed at it, ready for seeding. */
async function prepare(label: string): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), `space-export-${label}-`));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = folder;
  CONFIG.embeddingDimensions = 4;
  return folder;
}

async function seedSpace(folder: string, memories: SeedMemory[]): Promise<void> {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    for (const memory of memories) {
      const containerTag = memory.containerTag ?? PROJECT_TAG;
      const isUser = containerTag === USER_TAG;
      const shard = await store.shards.getWriteShard(
        isUser ? "user" : "project",
        isUser ? USER_HASH : HASH
      );
      const db = await store.connections.getConnection(shard.dbPath);
      await tursoVectorSearch.insertVector(db, {
        id: memory.id,
        content: memory.content,
        vector: new Float32Array([1, 0, 0, 0]),
        containerTag,
        tags: memory.tags,
        type: memory.type,
        createdAt: memory.createdAt,
        updatedAt: memory.createdAt,
        metadata: memory.metadata === undefined ? undefined : JSON.stringify(memory.metadata),
        displayName: memory.displayName,
        userName: memory.userName,
        userEmail: memory.userEmail,
        projectPath: memory.projectPath,
        projectName: memory.projectName,
        gitRepoUrl: memory.gitRepoUrl,
      });
      if (memory.pinned) {
        await db.run(`UPDATE memories SET is_pinned = 1 WHERE id = ?`, [memory.id]);
      }
      await store.shards.incrementVectorCount(shard.id);
    }
  } finally {
    await store.close();
  }
}

/** Writes a learned profile with vector and identity fields into the space folder. */
async function seedProfile(folder: string): Promise<void> {
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  const manager = new UserProfileManager(folder);
  await manager.createProfile(
    "user-qa",
    "QA Tester",
    "qa",
    "qa@example.org",
    {
      preferences: [
        {
          category: "Tooling",
          description: "Prefers Vitest over Jest",
          confidence: 0.9,
          frequency: 4,
          evidence: ["Said to mail sam@example.org about runners"],
          lastSeen: 200,
          firstSeen: 100,
          centroid: [0.1, 0.2, 0.3, 0.4],
          anchor: [0.4, 0.3, 0.2, 0.1],
          alpha: 2,
          beta: 3,
          weakHitCount: 1,
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
          centroid: [9, 9, 9, 9],
        },
      ],
    },
    12
  );
}

function baseOptions(folder: string, outPath: string): ExportSpaceOptions {
  return {
    folder,
    outPath,
    embeddingModel: "test-embed",
    embeddingDimensions: 4,
    ommsVersion: "9.9.9-test",
    homePath: HOME,
  };
}

async function runExport(options: ExportSpaceOptions) {
  const { exportSpace } = await import("../src/services/spaces/export-space.js");
  return exportSpace(options);
}

function readDocument(outPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(outPath, "utf-8")) as Record<string, unknown>;
}

describe("space export", () => {
  let folder = "";

  afterEach(async () => {
    await cleanupTursoTestDirectory();
    if (folder) await removeTestDir(folder);
    folder = "";
  });

  it("writes the safe memory fields and no identity or vector field", async () => {
    folder = await prepare("fields");
    await seedSpace(folder, [
      {
        id: "export_field_1",
        content: "the config is in /Users/qa/work/app/config.json, ask jo@example.org",
        tags: "vue, testing",
        type: "note",
        createdAt: 100,
        pinned: true,
        displayName: "QA Tester",
        userName: "qa",
        userEmail: "qa@example.org",
        projectPath: "/Users/qa/work/app",
        projectName: "app",
        gitRepoUrl: "https://git.example.com/app.git",
      },
    ]);
    const outPath = join(folder, "out", "space-export.json");
    const result = await runExport(baseOptions(folder, outPath));

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    expect(document.format).toBe("omms-space-export");
    expect(document.schemaVersion).toBe(1);
    expect(document.ommsVersion).toBe("9.9.9-test");
    expect(document.embedding).toEqual({ model: "test-embed", dimensions: 4 });

    const memories = document.memories as Array<Record<string, unknown>>;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual({
      id: "export_field_1",
      content: "the config is in ~/work/app/config.json, ask <email>",
      scope: "project",
      projectTag: PROJECT_TAG,
      type: "note",
      tags: ["vue", "testing"],
      createdAt: 100,
      updatedAt: 100,
      isPinned: true,
    });

    const serialised = JSON.stringify(document);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    // The file names no space, so the import asks for the new space's name.
    expect(Object.keys(document).sort()).toEqual([
      "embedding",
      "exportedAt",
      "format",
      "memories",
      "ommsVersion",
      "schemaVersion",
    ]);
    for (const key of ["name", "spaceName", "sourceSpace"]) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(result.counts.pathsReplaced).toBe(1);
    expect(result.counts.emailsReplaced).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/free-text/i);
  });

  it("keeps the date range inclusive at both ends", async () => {
    folder = await prepare("range");
    await seedSpace(folder, [
      { id: "range_a", content: "first lesson", createdAt: 100 },
      { id: "range_b", content: "second lesson", createdAt: 200 },
      { id: "range_c", content: "third lesson", createdAt: 300 },
    ]);
    const outPath = join(folder, "range.json");
    const result = await runExport({ ...baseOptions(folder, outPath), since: 100, until: 200 });

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    const ids = (document.memories as Array<{ id: string }>).map((memory) => memory.id);
    expect(ids).toEqual(["range_b", "range_a"]);
  });

  it("writes no file when the selection is empty", async () => {
    folder = await prepare("empty");
    await seedSpace(folder, [{ id: "empty_1", content: "outside the window", createdAt: 100 }]);
    const outPath = join(folder, "none.json");
    const result = await runExport({ ...baseOptions(folder, outPath), since: 500, until: 600 });

    expect(result.written).toBe(false);
    expect(result.reason ?? "").toMatch(/nothing to export/i);
    expect(existsSync(outPath)).toBe(false);
    expect(readdirSync(folder).some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("leaves a fully private memory out and counts it", async () => {
    folder = await prepare("private");
    await seedSpace(folder, [
      { id: "private_one", content: "<private>whole turn is private</private>", createdAt: 100 },
      { id: "open_one", content: "shared lesson", createdAt: 200 },
    ]);
    const outPath = join(folder, "private.json");
    const result = await runExport(baseOptions(folder, outPath));

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    const ids = (document.memories as Array<{ id: string }>).map((memory) => memory.id);
    expect(ids).toEqual(["open_one"]);
    expect(result.counts.privateSkipped).toBe(1);
  });

  it("reports nothing to export when every memory is fully private", async () => {
    folder = await prepare("all-private");
    await seedSpace(folder, [
      { id: "private_only", content: "<private>everything</private>", createdAt: 100 },
    ]);
    const outPath = join(folder, "none.json");
    const result = await runExport(baseOptions(folder, outPath));

    expect(result.written).toBe(false);
    expect(existsSync(outPath)).toBe(false);
  });

  it("drops path and identity metadata keys and scrubs the rest deeply", async () => {
    folder = await prepare("metadata");
    await seedSpace(folder, [
      {
        id: "metadata_1",
        content: "metadata case",
        createdAt: 100,
        displayName: "QA Tester",
        userEmail: "qa@example.org",
        gitRepoUrl: "https://git.example.com/app.git",
        metadata: {
          config: "/Users/qa/work/app/config.json",
          owner: "QA Tester",
          contact: "qa@example.org",
          repo: "https://git.example.com/app.git",
          hostsFile: "/etc/hosts",
          note: "lives at /Users/qa/work/notes.md here",
          count: 3,
          nested: { hint: "ping other@example.org", link: "/etc/hosts" },
        },
      },
    ]);
    const outPath = join(folder, "metadata.json");
    const result = await runExport(baseOptions(folder, outPath));

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    const memory = (document.memories as Array<Record<string, unknown>>)[0]!;
    const metadata = memory.metadata as Record<string, unknown>;
    expect(metadata.config).toBeUndefined();
    expect(metadata.owner).toBeUndefined();
    expect(metadata.contact).toBeUndefined();
    expect(metadata.repo).toBeUndefined();
    expect(metadata.hostsFile).toBeUndefined();
    expect(metadata.note).toBe("lives at ~/work/notes.md here");
    expect(metadata.count).toBe(3);
    const nested = metadata.nested as Record<string, unknown>;
    expect(nested.hint).toBe("ping <email>");
    expect(nested.link).toBeUndefined();
    expect(result.counts.pathsReplaced).toBe(1);
    expect(result.counts.emailsReplaced).toBe(1);
  });

  it("leaves the space folder byte-identical", async () => {
    folder = await prepare("readonly");
    await seedSpace(folder, [
      { id: "readonly_1", content: "project lesson", createdAt: 100 },
      { id: "readonly_user", content: "personal lesson", containerTag: USER_TAG, createdAt: 150 },
    ]);
    await seedProfile(folder);
    const before = hashFolder(folder);
    expect(before.size).toBeGreaterThan(0);

    const outPath = join(folder, "..", "readonly-export.json");
    const result = await runExport({ ...baseOptions(folder, outPath), includeProfile: true });
    expect(result.written).toBe(true);

    expect(hashFolder(folder)).toEqual(before);
  });

  it("writes atomically and leaves no partial file on a failed write", async () => {
    folder = await prepare("atomic");
    await seedSpace(folder, [{ id: "atomic_1", content: "atomic lesson", createdAt: 100 }]);

    const outDir = join(folder, "atomic-out");
    mkdirSync(outDir);
    const outPath = join(outDir, "export.json");
    const ok = await runExport(baseOptions(folder, outPath));
    expect(ok.written).toBe(true);
    expect(readdirSync(outDir)).toEqual(["export.json"]);

    // The target path is a directory, so the rename fails after the temporary
    // file was written: nothing partial may survive at the target.
    const blockedDir = join(folder, "blocked");
    const blockedPath = join(blockedDir, "export.json");
    mkdirSync(blockedDir);
    mkdirSync(blockedPath);
    await expect(runExport(baseOptions(folder, blockedPath))).rejects.toThrow();
    expect(readdirSync(blockedDir)).toEqual(["export.json"]);
    expect(statSync(blockedPath).isDirectory()).toBe(true);
  });

  it("fails the export when an identifier escapes the scrubber", async () => {
    folder = await prepare("scan");
    await seedSpace(folder, [
      {
        id: "scan_1",
        content: "hostile metadata case",
        createdAt: 100,
        metadata: {
          // "x" before the path blocks the scrubber lookbehind; the whole value
          // is not a path, so the metadata rule keeps it as a string.
          escapePath: "x/Users/qa/secret.txt",
          // A quoted local part blocks the scrubber email rule.
          escapeEmail: '"jo doe"@qa.example.org',
        },
      },
    ]);
    const outPath = join(folder, "scan.json");
    await expect(runExport(baseOptions(folder, outPath))).rejects.toThrow(
      /identifier scan|identifier/i
    );
    expect(existsSync(outPath)).toBe(false);
    expect(readdirSync(folder).some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("keeps system paths and URLs and does not fail the scan", async () => {
    folder = await prepare("urls");
    await seedSpace(folder, [
      {
        id: "urls_1",
        content: "runs /usr/local/bin/node and reads https://example.com/docs",
        createdAt: 100,
      },
    ]);
    const outPath = join(folder, "urls.json");
    const result = await runExport(baseOptions(folder, outPath));

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    const memory = (document.memories as Array<{ content: string }>)[0]!;
    expect(memory.content).toBe("runs /usr/local/bin/node and reads https://example.com/docs");
  });

  it("holds no profile and no user-scope memory by default", async () => {
    folder = await prepare("default");
    await seedSpace(folder, [
      { id: "default_project", content: "project lesson", createdAt: 200 },
      { id: "default_user", content: "personal lesson", containerTag: USER_TAG, createdAt: 300 },
    ]);
    await seedProfile(folder);
    const outPath = join(folder, "default.json");
    const result = await runExport(baseOptions(folder, outPath));

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    const ids = (document.memories as Array<{ id: string }>).map((memory) => memory.id);
    expect(ids).toEqual(["default_project"]);
    expect(JSON.stringify(document)).not.toContain('"profile"');
    expect(result.counts.projectMemories).toBe(1);
    expect(result.counts.userMemories).toBe(0);
    expect(result.counts.profileItems).toBe(0);
  });

  it("adds user-scope memories and a scrubbed, vector-free profile on the opt-in", async () => {
    folder = await prepare("optin");
    await seedSpace(folder, [
      { id: "optin_project", content: "project lesson", createdAt: 200 },
      {
        id: "optin_user",
        content: "personal note about /Users/qa/keys",
        containerTag: USER_TAG,
        createdAt: 300,
      },
    ]);
    await seedProfile(folder);
    const outPath = join(folder, "optin.json");
    const result = await runExport({ ...baseOptions(folder, outPath), includeProfile: true });

    expect(result.written).toBe(true);
    const document = readDocument(outPath);
    const memories = document.memories as Array<Record<string, unknown>>;
    expect(memories).toHaveLength(2);

    const userMemory = memories.find((memory) => memory.id === "optin_user")!;
    expect(userMemory.scope).toBe("user");
    expect("projectTag" in userMemory).toBe(false);
    expect(userMemory.content).toBe("personal note about ~/keys");

    const projectMemory = memories.find((memory) => memory.id === "optin_project")!;
    expect(projectMemory.projectTag).toBe(PROJECT_TAG);

    const profile = document.profile as Record<string, unknown>;
    expect(profile.version).toBe(1);
    expect(profile.totalPromptsAnalyzed).toBe(12);
    expect(profile.preferences).toEqual([
      {
        category: "Tooling",
        description: "Prefers Vitest over Jest",
        confidence: 0.9,
        frequency: 4,
        evidence: ["Said to mail <email> about runners"],
        lastSeen: 200,
        firstSeen: 100,
      },
    ]);
    expect(profile.patterns).toEqual([
      {
        category: "Style",
        description: "Writes short functions",
        confidence: 0.8,
        frequency: 2,
        evidence: [],
        lastSeen: 210,
      },
    ]);
    expect(profile.workflows).toEqual([
      {
        description: "Ship checklist",
        steps: ["run tests", "bump the version", "tag the release"],
        confidence: 0.7,
        frequency: 1,
        evidence: [],
        lastSeen: 220,
      },
    ]);
    expect(result.counts.userMemories).toBe(1);
    expect(result.counts.profileItems).toBe(3);

    const serialised = JSON.stringify(document);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(serialised).not.toContain("QA Tester");
    expect(serialised).not.toContain("qa@example.org");
    expect(serialised).not.toContain("user-qa");
  });
});
