import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The store settings reader (design D5a "S"). Store singletons load before any edge runs, so
// every value must be read from the live CONFIG on each call. config.ts replaces CONFIG on a
// reload or a space switch, and tests change its fields in place; both must reach the reader.

const config = await import("../src/config.js");
const reader = await import("../src/services/storage/active-space-access.js");
const { createStoredSpace, spaceFiles, switchStoredSpace } =
  await import("../src/services/spaces/registry-store.js");

const files = spaceFiles(join(homedir(), ".omms"));
const globalConfigPath = join(homedir(), ".config", "omms", "omms.jsonc");
let project = "";

/** Each simple getter and the CONFIG field it reads. */
const fieldGetters = {
  getStoragePath: "storagePath",
  getEmbeddingModel: "embeddingModel",
  getEmbeddingDimensions: "embeddingDimensions",
  getEmbeddingApiUrl: "embeddingApiUrl",
  getEmbeddingApiKey: "embeddingApiKey",
  getEmbeddingUseTaskPrefixes: "embeddingUseTaskPrefixes",
  getMaxVectorsPerShard: "maxVectorsPerShard",
  getContainerTagPrefix: "containerTagPrefix",
  getUserEmailOverride: "userEmailOverride",
  getUserNameOverride: "userNameOverride",
  getAiSessionRetentionDays: "aiSessionRetentionDays",
} as const;

type Getter = keyof typeof fieldGetters;
type MutableConfig = Record<string, unknown>;

/** A value of the right type that no earlier step set, so a stale read shows. */
function freshValue(field: string, round: number): unknown {
  const sample = (config.CONFIG as unknown as MutableConfig)[field];
  if (typeof sample === "number") return 1000 + round;
  if (typeof sample === "boolean") return round % 2 === 0;
  return `${field}-${round}`;
}

function writeGlobalConfig(value: Record<string, unknown>): void {
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(globalConfigPath, JSON.stringify(value));
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-store-reader-"));
  writeGlobalConfig({ embeddingDimensions: 4 });
  config.initConfig(project);
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(files.spacesRoot, { recursive: true, force: true });
  rmSync(files.registryPath, { force: true });
  rmSync(globalConfigPath, { force: true });
});

describe("store settings reader", () => {
  it("exports exactly the fixed list of readers", () => {
    // A new reader needs a design change (D5a). Add it here on purpose, not by accident.
    expect(Object.keys(reader).sort()).toEqual(
      [
        "activeOwner",
        "getActiveSpaceLabel",
        "getAiSessionRetentionDays",
        "getContainerTagPrefix",
        "getEmbeddingApiKey",
        "getEmbeddingApiUrl",
        "getEmbeddingCacheDir",
        "getEmbeddingDimensions",
        "getEmbeddingModel",
        "getEmbeddingUseTaskPrefixes",
        "getExplicitContainerTagPrefix",
        "getMaxVectorsPerShard",
        "getProfileSettings",
        "getSkillStoragePath",
        "getStoragePath",
        "getUserEmailOverride",
        "getUserNameOverride",
      ].sort()
    );
  });

  it("keeps the old path as a shim that re-exports the same readers", async () => {
    // Slice F of the storage port removes the shim and this check.
    const shim = await import("../src/services/active-space-access.js");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(reader).sort());
    expect(shim.getStoragePath).toBe(reader.getStoragePath);
  });

  it("reads each field again after CONFIG changes in place", () => {
    const live = config.CONFIG as unknown as MutableConfig;
    for (const round of [1, 2]) {
      for (const [getter, field] of Object.entries(fieldGetters)) {
        live[field] = freshValue(field, round);
        expect([getter, reader[getter as Getter]()]).toEqual([getter, live[field]]);
      }
    }
  });

  it("reads the new CONFIG object after a reload replaces it", () => {
    const before = config.CONFIG as unknown as MutableConfig;
    config.initConfig(project);
    const after = config.CONFIG as unknown as MutableConfig;
    expect(after).not.toBe(before);
    for (const [getter, field] of Object.entries(fieldGetters)) {
      before[field] = freshValue(field, 3);
      after[field] = freshValue(field, 4);
      expect([getter, reader[getter as Getter]()]).toEqual([getter, after[field]]);
    }
  });

  it("falls back to the storage path for the skills path and the model cache", () => {
    const live = config.CONFIG as unknown as MutableConfig;
    live.storagePath = "/space-a";
    live.skillStoragePath = undefined;
    expect(reader.getSkillStoragePath()).toBe("/space-a");
    expect(reader.getEmbeddingCacheDir()).toBe(join("/space-a", ".cache"));
    live.skillStoragePath = "/global";
    expect(reader.getSkillStoragePath()).toBe("/global");
    expect(reader.getEmbeddingCacheDir()).toBe(join("/global", ".cache"));
    live.skillStoragePath = "/global-2";
    expect(reader.getEmbeddingCacheDir()).toBe(join("/global-2", ".cache"));
  });

  it("builds fresh profile settings from the live CONFIG on each call", () => {
    const live = config.CONFIG as unknown as MutableConfig;
    const first = reader.getProfileSettings();
    expect(first).not.toBe(config.CONFIG);
    for (const field of Object.keys(first)) {
      live[field] = freshValue(field, 5);
    }
    const second = reader.getProfileSettings();
    expect(second).not.toBe(first);
    for (const field of Object.keys(first)) {
      expect([field, (second as unknown as MutableConfig)[field]]).toEqual([field, live[field]]);
    }
  });

  it("reads the explicit tag prefix from the latest config file", () => {
    writeGlobalConfig({ embeddingDimensions: 4, containerTagPrefix: "alpha" });
    config.initConfig(project);
    expect(reader.getExplicitContainerTagPrefix()).toBe("alpha");
    writeGlobalConfig({ embeddingDimensions: 4 });
    config.initConfig(project);
    expect(reader.getExplicitContainerTagPrefix()).toBeUndefined();
  });

  it("puts the default lock roots in the live storage path", async () => {
    const { acquireTursoOperationLock, assertNoTursoMigrationInProgress } =
      await import("../src/services/turso/operation-lock.js");
    const { withCrossProcessWriteLock } =
      await import("../src/services/turso/cross-process-write-lock.js");
    const [folderA, folderB] = ["a", "b"].map((name) => join(project, `locks-${name}`));
    mkdirSync(folderA);
    mkdirSync(folderB);
    config.CONFIG.storagePath = folderA;
    const release = acquireTursoOperationLock("reader-test");
    try {
      expect(() => assertNoTursoMigrationInProgress()).toThrow("migration is in progress");
      config.CONFIG.storagePath = folderB;
      expect(() => assertNoTursoMigrationInProgress()).not.toThrow();
      await withCrossProcessWriteLock("project", "0123456789abcdef", async () => {});
      expect(existsSync(join(folderB, ".write-locks"))).toBe(true);
      expect(existsSync(join(folderA, ".write-locks"))).toBe(false);
    } finally {
      release();
    }
  });

  it("follows a memory space switch and back", async () => {
    config.initConfig(project);
    const defaultFolder = reader.getStoragePath();
    expect(reader.activeOwner().id).toBe("default");

    const space = await createStoredSpace(files, "Reader");
    await switchStoredSpace(files, space.id);
    config.refreshConfigIfChanged(project);
    expect(reader.getStoragePath()).toBe(join(files.spacesRoot, space.id));
    expect(reader.activeOwner().id).toBe(space.id);
    expect(reader.getActiveSpaceLabel()).toEqual({ name: "Reader", customStoragePath: false });
    // skills.db and the model cache stay on the global path in every space.
    expect(reader.getSkillStoragePath()).toBe(defaultFolder);

    await switchStoredSpace(files, "default");
    config.refreshConfigIfChanged(project);
    expect(reader.getStoragePath()).toBe(defaultFolder);
    expect(reader.activeOwner().id).toBe("default");
    expect(reader.getActiveSpaceLabel()).toEqual({ name: "Default", customStoragePath: false });
  });
});
