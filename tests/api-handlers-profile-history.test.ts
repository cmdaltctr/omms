import { describe, expect, it, mock } from "bun:test";

const calls: Array<{ method: string; args: unknown[] }> = [];
let changelogs: unknown[] = [];
let snapshot: unknown;

mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    async getProfileChangelogs(profileId: string, limit: number) {
      calls.push({ method: "getProfileChangelogs", args: [profileId, limit] });
      return changelogs;
    },
    async getChangelogById(id: string) {
      calls.push({ method: "getChangelogById", args: [id] });
      return snapshot;
    },
  },
}));

const { handleGetProfileChangelog, handleGetProfileSnapshot } =
  await import("../src/services/api-handlers.js");

describe("api handlers: profile history", () => {
  it("lists changelog entries with ISO dates and the default limit of 5", async () => {
    changelogs = [
      {
        id: "cl_1",
        profileId: "profile_1",
        version: 2,
        changeType: "update",
        changeSummary: "Edited preference at index 0",
        createdAt: Date.UTC(2026, 0, 2),
        profileDataSnapshot: "{}",
      },
    ];
    const result = await handleGetProfileChangelog("profile_1");

    expect(result).toEqual({
      success: true,
      data: [
        {
          id: "cl_1",
          profileId: "profile_1",
          version: 2,
          changeType: "update",
          changeSummary: "Edited preference at index 0",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(calls.at(-1)).toEqual({ method: "getProfileChangelogs", args: ["profile_1", 5] });
  });

  it("passes an explicit limit through and requires a profile id", async () => {
    changelogs = [];
    await handleGetProfileChangelog("profile_2", 12);
    expect(calls.at(-1)).toEqual({ method: "getProfileChangelogs", args: ["profile_2", 12] });

    expect(await handleGetProfileChangelog("")).toEqual({
      success: false,
      error: "profileId is required",
    });
  });

  it("returns a snapshot with the embedding vectors removed", async () => {
    const vector = [0.1, 0.2];
    snapshot = {
      version: 3,
      createdAt: Date.UTC(2026, 0, 3),
      profileDataSnapshot: JSON.stringify({
        preferences: [
          { category: "c", description: "likes tests", centroid: vector, anchor: vector },
        ],
        patterns: [],
        workflows: [],
      }),
    };
    const result = await handleGetProfileSnapshot("cl_3");

    expect(result.success).toBe(true);
    expect(result.data.version).toBe(3);
    expect(result.data.createdAt).toBe("2026-01-03T00:00:00.000Z");
    expect(result.data.profileData.preferences[0].description).toBe("likes tests");
    expect(JSON.stringify(result.data)).not.toContain("centroid");
    expect(JSON.stringify(result.data)).not.toContain("anchor");
    expect(calls.at(-1)).toEqual({ method: "getChangelogById", args: ["cl_3"] });
  });

  it("refuses an empty id and an unknown changelog", async () => {
    expect(await handleGetProfileSnapshot("")).toEqual({
      success: false,
      error: "changelogId is required",
    });
    snapshot = undefined;
    expect(await handleGetProfileSnapshot("cl_missing")).toEqual({
      success: false,
      error: "Changelog not found",
    });
  });
});
