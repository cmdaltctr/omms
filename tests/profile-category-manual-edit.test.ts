import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

let directory: string;
const userId = "category-edit@example.invalid";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-edit-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

it("saves manual category edits through the real category save path", async () => {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  CONFIG.userEmailOverride = userId;
  const { userProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  userProfileManager.reset();
  const item = (description: string) => ({
    category: "Communication style",
    description,
    confidence: 0.7,
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
      preferences: [item("First item"), item("Second item"), item("Third item")],
      patterns: [item("Pattern")],
      workflows: [],
    },
    5
  );
  const { handleUpdateProfileItem } = await import("../src/services/api-handlers.js");
  expect(
    (
      await handleUpdateProfileItem({
        type: "preferences",
        index: 0,
        action: "edit",
        category: "git_workflow",
      })
    ).success
  ).toBe(true);
  const afterNew = await userProfileManager.getProfileById(id);
  const data = JSON.parse(afterNew!.profileData);
  expect(data.preferences[0].category).toBe("Git workflow");
  expect(
    (
      await handleUpdateProfileItem({
        type: "preferences",
        index: 0,
        action: "edit",
        category: "communication_style",
      })
    ).success
  ).toBe(true);
  const afterVariant = await userProfileManager.getProfileById(id);
  const updated = JSON.parse(afterVariant!.profileData);
  expect(updated.preferences.map((entry: { category: string }) => entry.category)).toEqual(
    Array(3).fill("Communication style")
  );
  expect(updated.patterns).toEqual(data.patterns);
  expect(afterVariant!.totalPromptsAnalyzed).toBe(5);
});
