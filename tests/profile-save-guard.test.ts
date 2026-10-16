import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import type { UserProfileData } from "../src/services/user-profile/types.js";

let directory: string;

async function makeManager() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager();
}

function profile(...categories: string[]): UserProfileData {
  return {
    preferences: categories.map((category, index) => ({
      category,
      description: `Observation ${index}`,
      confidence: 0.6,
      frequency: 1,
      evidence: ["Evidence"],
      lastSeen: 123,
    })),
    patterns: [],
    workflows: [],
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-save-guard-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

async function seeded() {
  const manager = await makeManager();
  const id = await manager.createProfile(
    "test@example.invalid",
    "Test",
    "test",
    "test@example.invalid",
    profile("Old name"),
    1
  );
  return { manager, id };
}

describe("profile save guard", () => {
  it("lets only the first of two writers that read the same version save", async () => {
    const { manager, id } = await seeded();
    const first = await manager.getProfileById(id);
    const second = await manager.getProfileById(id);

    expect(await manager.updateProfile(id, profile("New name"), 0, "Cleanup", first!.version)).toBe(
      true
    );
    expect(
      await manager.updateProfile(id, profile("Old name"), 0, "Stale learning", second!.version)
    ).toBe(false);

    const stored = await manager.getProfileById(id);
    expect(JSON.parse(stored!.profileData).preferences[0].category).toBe("New name");
    expect(stored!.version).toBe(first!.version + 1);
  });

  it("refuses a save that carries no version", async () => {
    const { manager, id } = await seeded();
    const before = await manager.getProfileById(id);

    // @ts-expect-error The version is required.
    expect(await manager.updateProfile(id, profile("New name"), 0, "No version")).toBe(false);

    const stored = await manager.getProfileById(id);
    expect(stored!.version).toBe(before!.version);
    expect(JSON.parse(stored!.profileData).preferences[0].category).toBe("Old name");
  });

  it("skips a confidence decay save when another save landed first", async () => {
    const { userProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const { userPromptManager } =
      await import("../src/services/user-prompt/user-prompt-manager.js");
    const { handleRefreshProfile } = await import("../src/services/api-handlers.js");
    const read = { id: "profile-1", version: 40, profileData: JSON.stringify(profile("A")) };
    const spies = [
      spyOn(userProfileManager, "getActiveProfile").mockResolvedValue(read as any),
      spyOn(userProfileManager, "decayInMemory").mockReturnValue({
        data: profile("A"),
        hasChanges: true,
      }),
      spyOn(userPromptManager, "countUnanalyzedForUserLearning").mockResolvedValue(0),
    ];
    const save = spyOn(userProfileManager, "updateProfile").mockResolvedValue(false);
    try {
      const result = await handleRefreshProfile("test@example.invalid");
      expect(result.success).toBe(true);
      expect(result.data.decayApplied).toBe(false);
      expect(save.mock.calls[0]![4]).toBe(40);
    } finally {
      for (const spy of [...spies, save]) spy.mockRestore();
    }
  });

  it("tells the user to try again when a web edit meets a newer version", async () => {
    const { userProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const { handleUpdateProfileItem } = await import("../src/services/api-handlers.js");
    const read = { id: "profile-1", version: 40, profileData: JSON.stringify(profile("A")) };
    const reader = spyOn(userProfileManager, "getActiveProfile").mockResolvedValue(read as any);
    const save = spyOn(userProfileManager, "updateProfile").mockResolvedValue(false);
    try {
      const result = await handleUpdateProfileItem({
        type: "preferences",
        index: 0,
        action: "delete",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("modified by another session");
      expect(save.mock.calls[0]![4]).toBe(40);
    } finally {
      reader.mockRestore();
      save.mockRestore();
    }
  });
});
