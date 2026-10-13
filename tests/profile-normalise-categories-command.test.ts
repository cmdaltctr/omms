import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import type { UserProfileData } from "../src/services/user-profile/types.js";
import { runProfileNormaliseCategoriesCommand } from "../src/cli/profile-normalise-categories-command.js";

let directory: string;
let profileId: string;
let configPath: string;
let originalConfig: string;
let output: string[];
const userId = "normalise@example.invalid";
const print = (line: string) => output.push(line);
const item = (category: string, index: number) => ({
  category,
  description: `Observation ${index}`,
  confidence: 0.6,
  frequency: index + 1,
  evidence: ["Evidence"],
  lastSeen: 123,
  centroid: [1, 0],
  anchor: [1, 0],
});
const legacy: UserProfileData = {
  preferences: [
    "communication_style",
    "communication_style",
    "Communication style",
    "UI/UX",
    "",
    "explicit",
  ].map(item),
  patterns: [
    "Communication style",
    "Communication style",
    "writing_standards",
    "writing_standards",
  ].map(item),
  workflows: [
    {
      description: "Release",
      steps: ["Branch", "Test", "Release"],
      confidence: 0.6,
      frequency: 1,
      evidence: [],
      lastSeen: 123,
    },
  ],
  learning_paths: [{ topic: "Topic", chain: ["A"], description: "Path" }],
};

async function manager() {
  return (await import("../src/services/user-profile/user-profile-manager.js")).userProfileManager;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-normalise-command-"));
  output = [];
  const { getGlobalConfigWritePath, initConfig } = await import("../src/config.js");
  configPath = getGlobalConfigWritePath();
  originalConfig = readFileSync(configPath, "utf8");
  writeFileSync(configPath, JSON.stringify({ storagePath: directory, userEmailOverride: userId }));
  initConfig(process.cwd());
  const store = await manager();
  store.reset();
  profileId = await store.createProfile(userId, "Test", "test", userId, legacy, 7);
  // Seed a pre-normalisation profile and its existing snapshot without using the new save rules.
  const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
  await db.run("UPDATE user_profiles SET profile_data = ? WHERE id = ?", [
    JSON.stringify(legacy),
    profileId,
  ]);
  await db.run(
    "UPDATE user_profile_changelogs SET profile_data_snapshot = ? WHERE profile_id = ?",
    [JSON.stringify(legacy), profileId]
  );
});

afterEach(async () => {
  writeFileSync(configPath, originalConfig);
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

it("previews every rename and category counts without writing", async () => {
  const store = await manager();
  const before = await store.getProfileById(profileId);
  const logs = await store.getProfileChangelogs(profileId);
  expect(await runProfileNormaliseCategoriesCommand([], print)).toBe(0);
  expect(output.join("\n")).toContain('"communication_style" -> "Communication style": 2');
  expect(output.join("\n")).toContain('"" -> "General": 1');
  expect(output.join("\n")).toContain('"writing_standards" -> "Writing standards": 2');
  expect(output.join("\n")).toContain("Preference categories: 5 -> 4");
  expect(output.join("\n")).toContain("Pattern categories: 2 -> 2");
  expect(output.join("\n")).toContain("Changes: 5");
  expect(await store.getProfileById(profileId)).toEqual(before);
  expect(await store.getProfileChangelogs(profileId)).toEqual(logs);
});

it("writes nothing with --dry-run even when --yes is present", async () => {
  const store = await manager();
  const before = await store.getProfileById(profileId);
  expect(await runProfileNormaliseCategoriesCommand(["--dry-run", "--yes"], print)).toBe(0);
  expect(await store.getProfileById(profileId)).toEqual(before);
  expect(await store.getProfileChangelogs(profileId)).toHaveLength(1);
});

it("applies only category changes, retains the old snapshot, and is a no-op on a second run", async () => {
  const store = await manager();
  const before = await store.getProfileById(profileId);
  expect(await runProfileNormaliseCategoriesCommand(["--yes"], print)).toBe(0);
  const saved = await store.getProfileById(profileId);
  const data: UserProfileData = JSON.parse(saved!.profileData);
  expect(data).toEqual({
    ...legacy,
    preferences: legacy.preferences.map((entry) => ({
      ...entry,
      category:
        entry.category === "communication_style"
          ? "Communication style"
          : entry.category === ""
            ? "General"
            : entry.category,
    })),
    patterns: legacy.patterns.map((entry) => ({
      ...entry,
      category: entry.category === "writing_standards" ? "Writing standards" : entry.category,
    })),
  });
  expect(saved!.totalPromptsAnalyzed).toBe(before!.totalPromptsAnalyzed);
  expect(saved!.version).toBe(before!.version + 1);
  const logs = await store.getProfileChangelogs(profileId);
  expect(logs).toHaveLength(2);
  expect(JSON.parse(logs[0]!.profileDataSnapshot)).toEqual(data);
  expect(JSON.parse(logs[1]!.profileDataSnapshot)).toEqual(legacy);
  output = [];
  expect(await runProfileNormaliseCategoriesCommand(["--yes"], print)).toBe(0);
  expect(output.join("\n")).toContain("Changes: 0");
  expect(await store.getProfileById(profileId)).toEqual(saved);
  expect(await store.getProfileChangelogs(profileId)).toEqual(logs);
});

it("repairs Explicit variants to the reserved explicit label and is a no-op afterwards", async () => {
  const store = await manager();
  const seeded: UserProfileData = {
    ...legacy,
    preferences: ["Explicit", "Explicit", "explicit", "Communication style"].map(item),
    patterns: ["Explicit", "Explicit", "Explicit"].map(item),
  };
  const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
  await db.run("UPDATE user_profiles SET profile_data = ? WHERE id = ?", [
    JSON.stringify(seeded),
    profileId,
  ]);
  expect(await runProfileNormaliseCategoriesCommand([], print)).toBe(0);
  expect(output.join("\n")).toContain('"Explicit" -> "explicit": 5');
  expect(await runProfileNormaliseCategoriesCommand(["--yes"], print)).toBe(0);
  const saved = await store.getProfileById(profileId);
  const data: UserProfileData = JSON.parse(saved!.profileData);
  expect(data).toEqual({
    ...seeded,
    preferences: seeded.preferences.map((entry) => ({
      ...entry,
      category: entry.category === "Explicit" ? "explicit" : entry.category,
    })),
    patterns: seeded.patterns.map((entry) => ({ ...entry, category: "explicit" })),
  });
  output = [];
  expect(await runProfileNormaliseCategoriesCommand(["--yes"], print)).toBe(0);
  expect(output.join("\n")).toContain("Changes: 0");
  expect(await store.getProfileById(profileId)).toEqual(saved);
});

it("refuses unknown options without changing the profile", async () => {
  const store = await manager();
  const before = await store.getProfileById(profileId);
  expect(await runProfileNormaliseCategoriesCommand(["--nope"], print)).toBe(1);
  expect(output.join("\n")).toContain("Unknown option --nope");
  expect(await store.getProfileById(profileId)).toEqual(before);
});

it("dispatches the command and lists it in CLI help", async () => {
  const { runCli } = await import("../src/cli/index.js");
  const log = spyOn(console, "log").mockImplementation(print);
  try {
    expect(await runCli(["profile-normalise-categories", "--help"])).toBe(0);
    expect(output.join("\n")).toContain("Usage: om-memory-system profile-normalise-categories");
    output = [];
    expect(await runCli(["--help"])).toBe(0);
    expect(output.join("\n")).toContain("profile-normalise-categories");
  } finally {
    log.mockRestore();
  }
});
