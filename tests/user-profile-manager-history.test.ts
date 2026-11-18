import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

// Characterisation tests for UserProfileManager version history and profile removal.

let tmpDir: string;

async function makeManager(retention = 5) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = tmpDir;
  CONFIG.userProfileChangelogRetentionCount = retention;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager();
}

const data = (description: string) => ({
  preferences: [{ category: "Style", description, confidence: 0.5, evidence: [], lastUpdated: 1 }],
  patterns: [],
  workflows: [],
});

async function createWithUpdates(mgr: any, updates: number): Promise<string> {
  const id = await mgr.createProfile(
    "u@example.invalid",
    "U",
    "u",
    "u@example.invalid",
    data("v1"),
    2
  );
  for (let version = 1; version <= updates; version++) {
    const saved = await mgr.updateProfile(
      id,
      data(`v${version + 1}`),
      3,
      `update ${version}`,
      version
    );
    expect(saved).toBe(true);
  }
  return id;
}

describe("user profile manager version history", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-upm-history-"));
  });

  afterEach(async () => {
    await tursoConnectionManager.closeAll();
    await new Promise((r) => setTimeout(r, 50));
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore leftover test files
    }
  });

  it("records the creation as version 1 with a snapshot", async () => {
    const mgr = await makeManager();
    const id = await createWithUpdates(mgr, 0);

    const logs = await mgr.getProfileChangelogs(id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.profileId).toBe(id);
    expect(logs[0]!.version).toBe(1);
    expect(logs[0]!.changeType).toBe("create");
    expect(logs[0]!.changeSummary).toBe("Initial profile creation");
    expect(
      JSON.parse(logs[0]!.profileDataSnapshot as unknown as string).preferences[0].description
    ).toBe("v1");
    expect(logs[0]!.id).toMatch(/^changelog_\d+_[a-z0-9]+$/);
  });

  it("lists versions newest first and honours the limit", async () => {
    const mgr = await makeManager();
    const id = await createWithUpdates(mgr, 3);

    const logs = await mgr.getProfileChangelogs(id);
    expect(logs.map((log) => log.version)).toEqual([4, 3, 2, 1]);
    expect(logs.map((log) => log.changeType)).toEqual(["update", "update", "update", "create"]);
    expect(logs[0]!.changeSummary).toBe("update 3");

    const limited = await mgr.getProfileChangelogs(id, 2);
    expect(limited.map((log) => log.version)).toEqual([4, 3]);

    const profile = await mgr.getProfileById(id);
    expect(profile!.version).toBe(4);
    expect(profile!.totalPromptsAnalyzed).toBe(11);
  });

  it("keeps only the configured number of versions after an update", async () => {
    const mgr = await makeManager(3);
    const id = await createWithUpdates(mgr, 4);

    const logs = await mgr.getProfileChangelogs(id, 10);
    expect(logs.map((log) => log.version)).toEqual([5, 4, 3]);
  });

  it("finds a changelog entry by id and returns undefined for an unknown id", async () => {
    const mgr = await makeManager();
    const id = await createWithUpdates(mgr, 1);
    const [latest] = await mgr.getProfileChangelogs(id, 1);

    const found = await mgr.getChangelogById(latest!.id);
    expect(found).toEqual(latest);
    expect(await mgr.getChangelogById("changelog_missing")).toBeUndefined();
  });

  it("adds no version when the expected version is stale", async () => {
    const mgr = await makeManager();
    const id = await createWithUpdates(mgr, 1);

    expect(await mgr.updateProfile(id, data("late"), 1, "late", 1)).toBe(false);
    const logs = await mgr.getProfileChangelogs(id);
    expect(logs.map((log) => log.version)).toEqual([2, 1]);
  });
});

describe("user profile manager removal", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-upm-remove-"));
  });

  afterEach(async () => {
    await tursoConnectionManager.closeAll();
    await new Promise((r) => setTimeout(r, 50));
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore leftover test files
    }
  });

  it("deletes the profile row and drops its cold buffer", async () => {
    const mgr = await makeManager();
    const id = await createWithUpdates(mgr, 0);
    const other = await mgr.createProfile(
      "o@example.invalid",
      "O",
      "o",
      "o@example.invalid",
      data("o"),
      0
    );

    const cold = { isWarmedUp: false } as any;
    const empty = { preferences: [], patterns: [], workflows: [] };
    const observed = (description: string) => ({
      preferences: [{ category: "Style", description }] as any,
    });
    await mgr.mergeProfileData(empty, observed("Buffered for the first user"), cold, id);
    await mgr.mergeProfileData(empty, observed("Buffered for the other user"), cold, other);
    const bufferPath = join(tmpDir, "cold-buffer.json");
    expect(Object.keys(JSON.parse(readFileSync(bufferPath, "utf-8"))).sort()).toEqual(
      [id, other].sort()
    );

    await mgr.deleteProfile(id);

    expect(await mgr.getProfileById(id)).toBeNull();
    expect(await mgr.getActiveProfile("u@example.invalid")).toBeNull();
    expect((await mgr.getAllActiveProfiles()).map((p) => p.id)).toEqual([other]);
    expect(existsSync(bufferPath)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(bufferPath, "utf-8")))).toEqual([other]);
  });
});
