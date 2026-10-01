import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import {
  listProfiles,
  mergeProfiles,
  ProfileAdminError,
  type ProfileAdminStore,
} from "../src/services/profile-admin.js";
import type { UserProfile } from "../src/services/user-profile/types.js";

function profile(id: string, userId: string, items: number, prompts: number): UserProfile {
  const list = (prefix: string) =>
    Array.from({ length: items }, (_, i) => ({ category: "c", description: `${prefix}${i}` }));
  return {
    id,
    userId,
    displayName: userId,
    userName: userId,
    userEmail: userId,
    profileData: JSON.stringify({
      preferences: list(`${id}-pref`),
      patterns: list(`${id}-pat`),
      workflows: [],
    }),
    version: 1,
    createdAt: 1,
    lastAnalyzedAt: prompts,
    totalPromptsAnalyzed: prompts,
    isActive: true,
  };
}

function fakeStore(profiles: UserProfile[]) {
  const changelog: string[] = [];
  const store: ProfileAdminStore = {
    async getAllActiveProfiles() {
      return profiles.filter((p) => p.isActive);
    },
    async getProfileById(id) {
      return profiles.find((p) => p.id === id) ?? null;
    },
    async mergeProfileData(existing, updates) {
      return {
        preferences: [...existing.preferences, ...(updates.preferences ?? [])],
        patterns: [...existing.patterns, ...(updates.patterns ?? [])],
        workflows: [...existing.workflows, ...(updates.workflows ?? [])],
      };
    },
    async updateProfile(id, data, added, summary) {
      const p = profiles.find((x) => x.id === id)!;
      p.profileData = JSON.stringify(data);
      p.totalPromptsAnalyzed += added;
      changelog.push(summary);
      return true;
    },
    async deactivateProfile(id) {
      profiles.find((x) => x.id === id)!.isActive = false;
      return true;
    },
  };
  return { store, changelog };
}

describe("profile admin", () => {
  it("lists active profiles with counts and marks the one in use", async () => {
    const { store } = fakeStore([
      profile("a", "me@example.com", 3, 30),
      profile("b", "bot@example.com", 1, 10),
    ]);
    const list = await listProfiles(store, "me@example.com");
    expect(list.map((p) => [p.userId, p.preferences, p.patterns, p.inUse])).toEqual([
      ["me@example.com", 3, 3, true],
      ["bot@example.com", 1, 1, false],
    ]);
  });

  it("merges a stray profile into the target and turns the source off", async () => {
    const profiles = [
      profile("a", "me@example.com", 3, 30),
      profile("b", "bot@example.com", 1, 10),
    ];
    const { store, changelog } = fakeStore(profiles);
    const { target } = await mergeProfiles(store, "b", "a");
    expect(target.preferences).toBe(4);
    expect(target.totalPromptsAnalyzed).toBe(40);
    expect(changelog).toEqual(["Merged profile bot@example.com"]);
    expect(profiles[1]!.isActive).toBe(false);
    expect((await listProfiles(store, "me@example.com")).length).toBe(1);
  });

  it("refuses to merge a profile into itself or into a missing profile", async () => {
    const { store } = fakeStore([profile("a", "me@example.com", 1, 1)]);
    await expect(mergeProfiles(store, "a", "a")).rejects.toBeInstanceOf(ProfileAdminError);
    await expect(mergeProfiles(store, "x", "a")).rejects.toMatchObject({ status: 404 });
  });
});

describe("UserProfileManager.deactivateProfile", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-profile-admin-"));
  });
  afterEach(async () => {
    await tursoConnectionManager.closeAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps the row but removes it from the active list", async () => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = tmpDir;
    const { UserProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const mgr = new UserProfileManager();
    const empty = { preferences: [], patterns: [], workflows: [] };
    const id = await mgr.createProfile("bot@example.com", "b", "b", "bot@example.com", empty, 0);
    await mgr.createProfile("me@example.com", "m", "m", "me@example.com", empty, 0);
    expect(await mgr.deactivateProfile(id)).toBe(true);
    expect((await mgr.getAllActiveProfiles()).map((p) => p.userId)).toEqual(["me@example.com"]);
    expect((await mgr.getProfileById(id))?.isActive).toBe(false);
  });
});
