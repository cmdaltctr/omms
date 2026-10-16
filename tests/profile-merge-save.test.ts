import { describe, expect, it } from "bun:test";
import {
  MAX_PROFILE_SAVE_ATTEMPTS,
  saveMergedProfile,
  saveProfile,
  type ProfileSaveStore,
} from "../src/services/user-profile/merge-and-save.js";
import type { UserProfileData } from "../src/services/user-profile/types.js";

const data = (...categories: string[]): UserProfileData => ({
  preferences: categories.map((category, index) => ({
    category,
    description: `Observation ${index}`,
    confidence: 0.6,
    frequency: 1,
    evidence: ["Evidence"],
    lastSeen: 1,
  })),
  patterns: [],
  workflows: [],
});

/** A store whose saves fail `failures` times, and whose profile moves on each time. */
function fakeStore(failures: number) {
  let version = 10;
  let category = "Old name";
  let failed = 0;
  const saves: { version: number; categories: string[] }[] = [];
  const merges: string[][] = [];
  const store: ProfileSaveStore = {
    async getProfileById(id) {
      return {
        id,
        version,
        profileData: JSON.stringify(data(category)),
      } as Awaited<ReturnType<ProfileSaveStore["getProfileById"]>>;
    },
    async mergeProfileData(existing, updates) {
      merges.push(existing.preferences.map((item) => item.category));
      return {
        ...existing,
        preferences: [...existing.preferences, ...(updates.preferences ?? [])],
      };
    },
    async updateProfile(_id, saved, _prompts, _summary, expectedVersion) {
      saves.push({
        version: expectedVersion,
        categories: saved.preferences.map((item) => item.category),
      });
      if (failed < failures) {
        failed++;
        // Another writer saves first: a cleanup renames the category and bumps the version.
        version++;
        category = "New name";
        return false;
      }
      return expectedVersion === version;
    },
  };
  return { store, saves, merges };
}

const read = { id: "p1", version: 10, profileData: JSON.stringify(data("Old name")) };
const raw = data("Fresh topic");

describe("saveMergedProfile", () => {
  it("saves once with the version it read when nothing changed", async () => {
    const { store, saves, merges } = fakeStore(0);
    const saved = await saveMergedProfile(
      store,
      read,
      { raw, merged: data("Old name", "Fresh topic") },
      10,
      "Analysis"
    );
    expect(saved).toBe(true);
    expect(saves).toEqual([{ version: 10, categories: ["Old name", "Fresh topic"] }]);
    expect(merges).toEqual([]);
  });

  it("merges the same result into the newer profile and saves with the newer version", async () => {
    const { store, saves, merges } = fakeStore(1);
    const saved = await saveMergedProfile(
      store,
      read,
      { raw, merged: data("Old name", "Fresh topic") },
      10,
      "Analysis"
    );
    expect(saved).toBe(true);
    expect(merges).toEqual([["New name"]]);
    expect(saves).toEqual([
      { version: 10, categories: ["Old name", "Fresh topic"] },
      { version: 11, categories: ["New name", "Fresh topic"] },
    ]);
  });

  it("stops after the last attempt and reports the failure", async () => {
    const { store, saves } = fakeStore(99);
    const saved = await saveMergedProfile(
      store,
      read,
      { raw, merged: data("Old name", "Fresh topic") },
      10,
      "Analysis"
    );
    expect(saved).toBe(false);
    expect(saves).toHaveLength(MAX_PROFILE_SAVE_ATTEMPTS);
    expect(MAX_PROFILE_SAVE_ATTEMPTS).toBe(3);
  });

  it("reports a profile that no longer exists as a failure", async () => {
    const { store } = fakeStore(1);
    store.getProfileById = async () => null;
    const saved = await saveMergedProfile(
      store,
      read,
      { raw, merged: data("Old name", "Fresh topic") },
      10,
      "Analysis"
    );
    expect(saved).toBe(false);
  });

  it("saves nothing when the analysis has no merged profile", async () => {
    const { store, saves } = fakeStore(0);
    const saved = await saveMergedProfile(store, read, { raw, merged: null }, 10, "Analysis");
    expect(saved).toBe(false);
    expect(saves).toEqual([]);
  });
});

describe("saveProfile", () => {
  it("saves with the id and version of the profile it read", async () => {
    const { store, saves } = fakeStore(0);
    expect(await saveProfile(read, data("New name"), "Edit", 0, store)).toBe(true);
    expect(saves).toEqual([{ version: 10, categories: ["New name"] }]);
  });

  it("returns false and does not retry when another save landed first", async () => {
    const { store, saves } = fakeStore(1);
    expect(await saveProfile(read, data("New name"), "Edit", 0, store)).toBe(false);
    expect(saves).toHaveLength(1);
  });
});
