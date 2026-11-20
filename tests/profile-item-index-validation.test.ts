import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

// A profile item edit or delete must name a whole-number index inside the list. `null`
// became index 0 and a fraction was rounded down, so the wrong item was deleted.

let directory: string;
const userId = "index-check@example.invalid";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-profile-index-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

it.each([null, 1.5, "1", true])(
  "refuses index %p and leaves the profile unchanged",
  async (index) => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = directory;
    CONFIG.userEmailOverride = userId;
    const { userProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    userProfileManager.reset();
    const item = (description: string, confidence: number) => ({
      category: "Communication style",
      description,
      confidence,
      frequency: 1,
      evidence: ["Evidence"],
      lastSeen: 123,
    });
    const id = await userProfileManager.createProfile(
      userId,
      "Test",
      "test",
      userId,
      {
        preferences: [item("First item", 0.9), item("Second item", 0.8), item("Third item", 0.7)],
        patterns: [],
        workflows: [],
      },
      5
    );
    const before = (await userProfileManager.getProfileById(id))!.profileData;
    const { handleUpdateProfileItem } = await import("../src/services/api-handlers.js");

    const result = await handleUpdateProfileItem(await import("../src/config.js"), {
      type: "preferences",
      index,
      action: "delete",
    });

    expect(result).toEqual({ success: false, error: "index must be a whole number in range" });
    expect((await userProfileManager.getProfileById(id))!.profileData).toBe(before);
  }
);
