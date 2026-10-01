import { describe, expect, it, mock } from "bun:test";

const vector = () => Array.from({ length: 1024 }, (_, i) => i / 1024);
const item = (description: string, confidence: number) => ({
  category: "c",
  description,
  confidence,
  frequency: 1,
  centroid: vector(),
  anchor: vector(),
});

let stored = {
  id: "profile_1",
  userId: "me@example.com",
  displayName: "Me",
  userName: "Me",
  userEmail: "me@example.com",
  version: 1,
  createdAt: 1,
  lastAnalyzedAt: 1,
  totalPromptsAnalyzed: 3,
  isActive: true,
  profileData: JSON.stringify({
    preferences: [item("first", 0.9), item("second", 0.5), item("third", 0.1)],
    patterns: [item("pattern", 0.5)],
    workflows: [{ description: "wf", steps: ["a"], frequency: 1, centroid: vector() }],
  }),
};

mock.module("../src/services/profile-identity.js", () => ({
  resolveWebProfileUserId: async () => "me@example.com",
}));
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    async getActiveProfile(userId: string) {
      return userId === stored.userId ? stored : null;
    },
    async updateProfile(_id: string, data: unknown) {
      stored = { ...stored, version: stored.version + 1, profileData: JSON.stringify(data) };
      return true;
    },
  },
}));

const { handleGetUserProfile, handleUpdateProfileItem } =
  await import("../src/services/api-handlers.js");

describe("profile API payload", () => {
  it("sends no embedding vectors to the browser", async () => {
    const result = await handleGetUserProfile();
    expect(result.success).toBe(true);
    const body = JSON.stringify(result.data);
    expect(body).not.toContain("centroid");
    expect(body).not.toContain("anchor");
    expect(result.data.profileData.preferences.map((p: any) => p.description)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("keeps the stored vectors of other items after a delete from the page", async () => {
    const result = await handleUpdateProfileItem({
      type: "preferences",
      index: 1,
      action: "delete",
    });
    expect(result.success).toBe(true);
    const saved = JSON.parse(stored.profileData);
    expect(saved.preferences.map((p: any) => p.description)).toEqual(["first", "third"]);
    for (const p of saved.preferences) {
      expect(p.centroid).toHaveLength(1024);
      expect(p.anchor).toHaveLength(1024);
    }
    expect(saved.workflows[0].centroid).toHaveLength(1024);
  });
});
