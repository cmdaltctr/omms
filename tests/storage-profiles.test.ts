import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the user profile store (storage port slice S11). The profile, its version
// history and the cleanup undo records are the user's long-lived learned data, so these tests pin
// what the store does today: reads, writes, the schema text, a space switch, the reset
// registration, history retention, record retention and a rooted manager. Every store is real,
// in its own temp folder.

const DAY = 24 * 60 * 60 * 1000;
const DB = "user-profiles.db";
let baseDir: string;
let otherDir: string;
let rootDir: string;
let savedPath: string;
let savedRetention: number;

async function loadConfig() {
  return (await import("../src/config.js")).CONFIG;
}

async function loadManager() {
  return await import("../src/services/user-profile/user-profile-manager.js");
}

async function loadAutoCleanups() {
  return await import("../src/services/storage/profiles/auto-cleanups.js");
}

async function loadCategoryCleanups() {
  return await import("../src/services/storage/profiles/category-cleanups.js");
}

/** Reads a table through a second, raw libSQL client, so the test does not trust the store. */
async function rawRows(folder: string, sql: string): Promise<Record<string, unknown>[]> {
  const client = createClient({ url: `file:${join(folder, DB)}` });
  try {
    return (await client.execute(sql)).rows as unknown as Record<string, unknown>[];
  } finally {
    client.close();
  }
}

function fileHash(folder: string): string {
  return createHash("sha256")
    .update(readFileSync(join(folder, DB)))
    .digest("hex");
}

function dbFiles(folder: string): string[] {
  return readdirSync(folder).filter((name) => name.endsWith(".db"));
}

const item = (category: string, description: string) => ({
  category,
  description,
  confidence: 0.5,
  evidence: [],
  lastUpdated: 1,
});

const workflow = (description: string, steps: string[]) => ({
  ...item("Flow", description),
  steps,
});

const data = (description: string) => ({
  preferences: [item("Style", description)],
  patterns: [],
  workflows: [],
});

async function newProfile(manager: any, userId = "u1", description = "v1"): Promise<string> {
  return manager.createProfile(
    userId,
    "Name",
    "user",
    `${userId}@example.invalid`,
    data(description),
    2
  );
}

describe("user profile store (characterisation)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "profiles-a-"));
    otherDir = mkdtempSync(join(tmpdir(), "profiles-b-"));
    rootDir = mkdtempSync(join(tmpdir(), "profiles-root-"));
    const config = await loadConfig();
    savedPath = config.storagePath;
    savedRetention = config.userProfileChangelogRetentionCount;
    config.storagePath = baseDir;
    config.userProfileChangelogRetentionCount = 5;
    const { userProfileManager } = await loadManager();
    userProfileManager.reset();
  });

  afterEach(async () => {
    const config = await loadConfig();
    config.storagePath = savedPath;
    config.userProfileChangelogRetentionCount = savedRetention;
    await cleanupTursoTestDirectory(baseDir);
    await cleanupTursoTestDirectory(otherDir);
    await cleanupTursoTestDirectory(rootDir);
  });

  // The old path stays as a re-export, so its callers and tests get the same store.
  it("keeps the old auto-cleanup-store path as a re-export of the same store", async () => {
    const moved = await loadAutoCleanups();
    const shim = await import("../src/services/user-profile/auto-cleanup-store.js");
    expect(shim.insertAutoCleanupRecord).toBe(moved.insertAutoCleanupRecord);
    expect(shim.latestOpenAutoCleanupSummary).toBe(moved.latestOpenAutoCleanupSummary);
    expect(shim.pruneAutoCleanupRecords).toBe(moved.pruneAutoCleanupRecords);
    expect(shim.AUTO_CLEANUP_RECORD_MAX_AGE_MS).toBe(moved.AUTO_CLEANUP_RECORD_MAX_AGE_MS);
  });

  // (r) read through the public API
  it("reads a created, updated, turned off and deleted profile through the facade", async () => {
    const { UserProfileManager } = await loadManager();
    const manager = new UserProfileManager();
    expect(await manager.getActiveProfile("u1")).toBeNull();

    const id = await manager.createProfile(
      "u1",
      "Display",
      "user",
      "u1@example.invalid",
      {
        preferences: [item("code_style", "one"), item("Code style", "two")],
        patterns: [item("code style", "three")],
        workflows: [workflow("short", ["a", "b"]), workflow("long", ["a", "b", "c"])],
      },
      4
    );
    expect(id).toMatch(/^profile_\d+_[a-z0-9]+$/);

    const created = await manager.getActiveProfile("u1");
    expect(created).toMatchObject({
      id,
      userId: "u1",
      displayName: "Display",
      userName: "user",
      userEmail: "u1@example.invalid",
      version: 1,
      totalPromptsAnalyzed: 4,
      isActive: true,
    });
    const createdData = JSON.parse(created!.profileData as unknown as string);
    // A new profile gets one label per category key and loses workflows with too few steps.
    expect(
      [...createdData.preferences, ...createdData.patterns].map((i: any) => i.category)
    ).toEqual(["Code style", "Code style", "Code style"]);
    expect(createdData.workflows.map((w: any) => w.description)).toEqual(["long"]);

    // An update keeps short workflows: only creation applies the step minimum.
    expect(
      await manager.updateProfile(
        id,
        { ...data("v2"), workflows: [workflow("short", ["a"])] } as any,
        3,
        "update one",
        1
      )
    ).toBe(true);
    const updated = await manager.getProfileById(id);
    expect(updated).toMatchObject({ version: 2, totalPromptsAnalyzed: 7, isActive: true });
    expect(
      JSON.parse(updated!.profileData as unknown as string).workflows.map((w: any) => w.description)
    ).toEqual(["short"]);
    // A stale expected version is refused and changes nothing.
    expect(await manager.updateProfile(id, data("late"), 1, "late", 1)).toBe(false);
    expect((await manager.getProfileById(id))!.version).toBe(2);

    const other = await newProfile(manager, "u2");
    expect((await manager.getAllActiveProfiles()).map((p) => p.id).sort()).toEqual(
      [id, other].sort()
    );

    expect(await manager.deactivateProfile(id)).toBe(true);
    expect(await manager.deactivateProfile("profile_missing")).toBe(false);
    expect(await manager.getActiveProfile("u1")).toBeNull();
    expect((await manager.getProfileById(id))!.isActive).toBe(false);
    expect((await manager.getAllActiveProfiles()).map((p) => p.id)).toEqual([other]);

    await manager.deleteProfile(other);
    expect(await manager.getProfileById(other)).toBeNull();
    expect(await manager.getProfileById("profile_missing")).toBeNull();
  });

  // (w) write through the API, read back with a raw client; the schema text is pinned too
  it("writes the documented rows and schema to user-profiles.db", async () => {
    const { UserProfileManager } = await loadManager();
    const autoCleanups = await loadAutoCleanups();
    const categoryCleanups = await loadCategoryCleanups();
    const manager = new UserProfileManager();
    const id = await newProfile(manager);
    await manager.updateProfile(id, data("v2"), 3, "second", 1);
    const recordId = await autoCleanups.insertAutoCleanupRecord(
      id,
      { promptsAnalyzed: 9, merged: 1, removed: 2, entries: [] },
      1_000
    );
    await categoryCleanups.recordCleanup(id, [
      { section: "preferences", descriptionSha256: "abc", from: "a", to: "b" },
    ]);
    await categoryCleanups.saveVerdicts(id, new Map([["g1", { keep: ["A"], name: "A" }]]), 2_000);

    const profiles = await rawRows(baseDir, "SELECT * FROM user_profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id,
      user_id: "u1",
      display_name: "Name",
      user_name: "user",
      user_email: "u1@example.invalid",
      version: 2,
      total_prompts_analyzed: 5,
      is_active: 1,
    });
    expect(JSON.parse(String(profiles[0]!.profile_data)).preferences[0].description).toBe("v2");

    const logs = await rawRows(baseDir, "SELECT * FROM user_profile_changelogs ORDER BY version");
    expect(logs.map((r) => [r.profile_id, r.version, r.change_type, r.change_summary])).toEqual([
      [id, 1, "create", "Initial profile creation"],
      [id, 2, "update", "second"],
    ]);
    expect(JSON.parse(String(logs[1]!.profile_data_snapshot)).preferences[0].description).toBe(
      "v2"
    );

    expect(await rawRows(baseDir, "SELECT * FROM profile_auto_cleanups")).toEqual([
      expect.objectContaining({
        id: recordId,
        profile_id: id,
        created_at: 1_000,
        prompts_analyzed: 9,
        merged: 1,
        removed: 2,
        entries: "[]",
        undone_at: null,
      }),
    ]);
    const cleanups = await rawRows(baseDir, "SELECT * FROM profile_category_cleanups");
    expect(cleanups).toHaveLength(1);
    expect(cleanups[0]).toMatchObject({
      profile_id: id,
      renames: '[{"section":"preferences","descriptionSha256":"abc","from":"a","to":"b"}]',
    });
    expect(await rawRows(baseDir, "SELECT * FROM profile_category_verdicts")).toEqual([
      expect.objectContaining({
        profile_id: id,
        group_id: "g1",
        keep: '["A"]',
        name: "A",
        created_at: 2_000,
      }),
    ]);

    // The CREATE text moves byte for byte: one hash over every table and index statement.
    const schema = await rawRows(
      baseDir,
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    expect(schema.map((row) => row.name)).toEqual([
      "idx_user_profile_changelogs_profile_id",
      "idx_user_profile_changelogs_version",
      "idx_user_profiles_is_active",
      "idx_user_profiles_user_id",
      "profile_auto_cleanups",
      "profile_category_cleanups",
      "profile_category_verdicts",
      "user_profile_changelogs",
      "user_profiles",
    ]);
    const schemaHash = createHash("sha256")
      .update(schema.map((row) => `${row.type}|${row.name}|${row.sql}`).join("\n"))
      .digest("hex");
    expect(schemaHash).toBe("4c20d67f0c59bf00370ee64f1fafda558e28ce7cd625c0163bc2e2454c20ddbf");
    expect(dbFiles(baseDir)).toEqual([DB]);
  });

  // (s) space switch: every table in user-profiles.db follows the active folder
  it("keeps each space's profile and cleanup records in its own folder across a switch", async () => {
    const config = await loadConfig();
    const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
    const { userProfileManager } = await loadManager();
    const autoCleanups = await loadAutoCleanups();
    const categoryCleanups = await loadCategoryCleanups();
    const record = { promptsAnalyzed: 1, merged: 1, removed: 0, entries: [] };
    const now = Date.now();

    const inA = await newProfile(userProfileManager, "in-A");
    await autoCleanups.insertAutoCleanupRecord(inA, record, now);
    await categoryCleanups.recordCleanup(inA, []);
    await categoryCleanups.saveVerdicts(inA, new Map([["gA", { keep: ["A"], name: null }]]), now);
    await resetStoreHandles();
    const aHash = fileHash(baseDir);

    config.storagePath = otherDir;
    await resetStoreHandles();
    expect(await userProfileManager.getActiveProfile("in-A")).toBeNull();
    expect(await userProfileManager.getAllActiveProfiles()).toEqual([]);
    expect(await autoCleanups.latestOpenAutoCleanupSummary(inA, now)).toBeNull();
    expect(await categoryCleanups.latestOpenCleanup(inA)).toBeNull();
    expect((await categoryCleanups.loadVerdicts(inA)).size).toBe(0);

    const inB = await newProfile(userProfileManager, "in-B");
    await autoCleanups.insertAutoCleanupRecord(inB, record, now);
    await categoryCleanups.recordCleanup(inB, []);
    await resetStoreHandles();

    expect(dbFiles(baseDir)).toEqual([DB]);
    expect(dbFiles(otherDir)).toEqual([DB]);
    expect(fileHash(baseDir)).toBe(aHash);
    expect(
      (await rawRows(otherDir, "SELECT user_id FROM user_profiles")).map((r) => r.user_id)
    ).toEqual(["in-B"]);
    expect(
      (await rawRows(otherDir, "SELECT profile_id FROM profile_auto_cleanups")).map(
        (r) => r.profile_id
      )
    ).toEqual([inB]);

    config.storagePath = baseDir;
    await resetStoreHandles();
    expect((await userProfileManager.getActiveProfile("in-A"))?.id).toBe(inA);
    expect(await userProfileManager.getActiveProfile("in-B")).toBeNull();
    expect((await autoCleanups.latestOpenAutoCleanupSummary(inA, now))?.merged).toBe(1);
    expect(await categoryCleanups.latestOpenCleanup(inA)).not.toBeNull();
    expect([...(await categoryCleanups.loadVerdicts(inA)).keys()]).toEqual(["gA"]);
    await resetStoreHandles();
    expect(fileHash(baseDir)).toBe(aHash);
  });

  // (h) reset registration and the path after a reset
  it("stays registered as user-profiles and opens the new path after a reset", async () => {
    const config = await loadConfig();
    const { registeredStoreResets } = await import("../src/services/spaces/store-handles.js");
    const { userProfileManager, UserProfileManager } = await loadManager();
    expect(registeredStoreResets()).toContain("user-profiles");

    const handle = userProfileManager as unknown as { dbPath: string; coldBufferPath: string };
    await userProfileManager.getActiveProfile("x");
    expect(handle.dbPath).toBe(join(baseDir, DB));

    config.storagePath = otherDir;
    userProfileManager.reset();
    expect(handle.dbPath).toBe(join(otherDir, DB));
    expect(handle.coldBufferPath).toBe(join(otherDir, "cold-buffer.json"));
    await userProfileManager.getActiveProfile("x");
    expect(dbFiles(otherDir)).toEqual([DB]);

    // A manager built after the switch reads the new folder too.
    expect((new UserProfileManager() as unknown as { dbPath: string }).dbPath).toBe(
      join(otherDir, DB)
    );
  });

  // Version history: one changelog row per change, and retention keeps the configured count
  it("writes one history row per change and keeps the configured number of versions", async () => {
    const config = await loadConfig();
    const { UserProfileManager } = await loadManager();
    const manager = new UserProfileManager();
    const id = await newProfile(manager);
    const count = async () =>
      Number((await rawRows(baseDir, "SELECT COUNT(*) AS n FROM user_profile_changelogs"))[0]!.n);
    expect(await count()).toBe(1);
    for (let version = 1; version <= 3; version++) {
      expect(
        await manager.updateProfile(id, data(`v${version + 1}`), 1, `u${version}`, version)
      ).toBe(true);
      expect(await count()).toBe(version + 1);
    }

    // The documented default keeps 5 versions; older ones go on the next update.
    for (let version = 4; version <= 7; version++) {
      await manager.updateProfile(id, data(`v${version + 1}`), 1, `u${version}`, version);
    }
    const versions = await rawRows(
      baseDir,
      "SELECT version FROM user_profile_changelogs ORDER BY version DESC"
    );
    expect(versions.map((r) => r.version)).toEqual([8, 7, 6, 5, 4]);

    // The count is read on each update, so a changed setting applies at once.
    config.userProfileChangelogRetentionCount = 2;
    await manager.updateProfile(id, data("v9"), 1, "u8", 8);
    expect((await manager.getProfileChangelogs(id, 10)).map((l) => l.version)).toEqual([9, 8]);

    // A refused save adds no row and prunes nothing.
    expect(await manager.updateProfile(id, data("stale"), 1, "stale", 1)).toBe(false);
    expect(await count()).toBe(2);
  });

  // Undo records and saved verdicts keep their documented 30-day retention
  it("deletes undo records and saved verdicts after 30 days", async () => {
    const autoCleanups = await loadAutoCleanups();
    const categoryCleanups = await loadCategoryCleanups();
    expect(autoCleanups.AUTO_CLEANUP_RECORD_MAX_AGE_MS).toBe(30 * DAY);
    expect(categoryCleanups.VERDICT_MAX_AGE_MS).toBe(30 * DAY);
    const record = { promptsAnalyzed: 1, merged: 0, removed: 1, entries: [] };

    const old = await autoCleanups.insertAutoCleanupRecord("p1", record, 1_000);
    const kept = await autoCleanups.insertAutoCleanupRecord("p1", record, 1_000 + 30 * DAY);
    expect(old).not.toBe(kept);
    expect(await autoCleanups.pruneAutoCleanupRecords(1_000 + 30 * DAY)).toBe(0);
    expect(await autoCleanups.pruneAutoCleanupRecords(1_001 + 30 * DAY)).toBe(1);
    expect(
      (await rawRows(baseDir, "SELECT id FROM profile_auto_cleanups")).map((r) => r.id)
    ).toEqual([kept]);
    await autoCleanups.markAutoCleanupUndone(kept, 5);
    expect(await autoCleanups.latestOpenAutoCleanup("p1", 1_001 + 30 * DAY)).toBeNull();

    await categoryCleanups.saveVerdicts("p1", new Map([["old", { keep: ["A"], name: "A" }]]), 0);
    await categoryCleanups.saveVerdicts("p1", new Map([["new", { keep: ["B"], name: null }]]), DAY);
    await categoryCleanups.pruneVerdicts("p1", ["old", "new"], undefined, 30 * DAY + 1);
    expect([...(await categoryCleanups.loadVerdicts("p1")).keys()]).toEqual(["new"]);
    await categoryCleanups.pruneVerdicts("p1", [], undefined, DAY);
    expect((await categoryCleanups.loadVerdicts("p1")).size).toBe(0);
  });

  // A rooted manager (profile import and export) reads and writes only under its root
  it("writes only under its root folder and refuses a root outside the storage folders", async () => {
    const { UserProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const { TursoConnectionManager } = await import("../src/services/turso/connection-manager.js");

    // The shared connections refuse a root outside the storage folders, and write nothing.
    const outside = new UserProfileManager(rootDir);
    await expect(newProfile(outside, "outside")).rejects.toThrow(
      "Refusing to open database outside storagePath"
    );
    expect(readdirSync(rootDir)).toEqual([]);
    expect(readdirSync(baseDir)).toEqual([]);

    // A root inside the storage folder, on the shared connections, writes only there.
    const inner = join(baseDir, "space-root");
    mkdirSync(inner);
    const rooted = new UserProfileManager(inner);
    const id = await newProfile(rooted, "rooted");
    await rooted.updateProfile(id, data("v2"), 1, "rooted update", 1);
    expect((await rooted.getActiveProfile("rooted"))?.version).toBe(2);
    expect(dbFiles(inner)).toEqual([DB]);
    expect(dbFiles(baseDir)).toEqual([]);
    expect(
      (
        await rawRows(inner, "SELECT change_type FROM user_profile_changelogs ORDER BY version")
      ).map((r) => r.change_type)
    ).toEqual(["create", "update"]);

    const connections = new TursoConnectionManager(createClient, () => [otherDir]);
    try {
      const own = new UserProfileManager(otherDir, connections);
      await newProfile(own, "own");
      expect((await own.getActiveProfile("own"))?.userId).toBe("own");
      expect(dbFiles(otherDir)).toEqual([DB]);
      expect(dbFiles(baseDir)).toEqual([]);
      // The rooted manager does not see the active store, and the active store does not see it.
      const { userProfileManager } = await loadManager();
      expect(await userProfileManager.getActiveProfile("own")).toBeNull();
    } finally {
      await connections.closeAll();
    }
  });
});
