import { describe, expect, it, mock } from "bun:test";

const now = Date.now();
const item = (category: string, description: string, confidence: number) => ({
  category,
  description,
  confidence,
  frequency: 1,
  lastSeen: now,
});
const PROFILE = {
  preferences: [
    item("style", "Use British spelling", 0.9),
    item("language", "Prefers TypeScript", 0.8),
    item("tooling", "Use bun as the package manager", 0.7),
  ],
  patterns: [item("habit", "Writes tests first", 0.9), item("habit2", "Small commits", 0.8)],
  workflows: [item("flow", "Plan then build", 0.9), item("flow2", "Review then merge", 0.8)],
};

mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: async () => ({ profileData: JSON.stringify(PROFILE) }),
  },
}));

const { getUserProfileContext } = await import("../src/services/user-profile/profile-context.js");

const config = (preferences: number, patterns: number, workflows: number) => ({
  userProfileInjectPreferences: preferences,
  userProfileInjectPatterns: patterns,
  userProfileInjectWorkflows: workflows,
  similarityThreshold: 0.5,
});
const lines = (text: string | null, prefix: string) =>
  (text ?? "").split("\n").filter((line) => line.startsWith(prefix)).length;

describe("getUserProfileContext reads the config it is given on every call", () => {
  it("uses the injection counts of each call, not those of an earlier call", async () => {
    const wide = await getUserProfileContext(config(3, 2, 2), "user");
    expect(
      lines(wide, "- [style]") + lines(wide, "- [language]") + lines(wide, "- [tooling]")
    ).toBe(3);
    expect(lines(wide, "- [habit")).toBe(2);
    expect(lines(wide, "- Plan") + lines(wide, "- Review")).toBe(2);

    const narrow = await getUserProfileContext(config(1, 1, 1), "user");
    expect(lines(narrow, "- [style]") + lines(narrow, "- [language]")).toBe(1);
    expect(lines(narrow, "- [tooling]")).toBe(0);
    expect(lines(narrow, "- [habit")).toBe(1);
    expect(lines(narrow, "- Plan") + lines(narrow, "- Review")).toBe(1);
  });

  it("falls back to the defaults when the counts are unset", async () => {
    const text = await getUserProfileContext(
      { ...config(3, 2, 2), userProfileInjectPreferences: undefined },
      "user"
    );
    // Default is 5 preferences, so all three stored items appear.
    expect(
      lines(text, "- [style]") + lines(text, "- [language]") + lines(text, "- [tooling]")
    ).toBe(3);
  });
});
