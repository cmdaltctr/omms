import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { runProfileCleanupCategoriesCommand } from "../src/cli/profile-cleanup-categories-command.js";

let directory: string;
let profileId: string;
let configPath: string;
let originalConfig: string;
let output: string[];
const userId = "cleanup-command@example.invalid";
const print = (line: string) => output.push(line);
const deps = {
  embed: async (text: string) => (text.includes("xecution") ? [1, 0.05] : [0, 1]),
  model: null,
};
const item = (category: string, index: number) => ({
  category,
  description: `Observation ${index}`,
  confidence: 0.6,
  frequency: index + 1,
  evidence: ["Evidence"],
  lastSeen: 123,
});

async function manager() {
  return (await import("../src/services/user-profile/user-profile-manager.js")).userProfileManager;
}

async function categories() {
  const profile = (await (await manager()).getProfileById(profileId))!;
  return JSON.parse(profile.profileData).preferences.map((entry: any) => entry.category);
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-cleanup-command-"));
  output = [];
  const { getGlobalConfigWritePath, initConfig } = await import("../src/config.js");
  configPath = getGlobalConfigWritePath();
  originalConfig = readFileSync(configPath, "utf8");
  writeFileSync(configPath, JSON.stringify({ storagePath: directory, userEmailOverride: userId }));
  initConfig(process.cwd());
  const store = await manager();
  store.reset();
  profileId = await store.createProfile(
    userId,
    "Test",
    "test",
    userId,
    {
      preferences: [
        item("Execution", 1),
        item("Execution", 2),
        item("Direct execution", 3),
        item("Language", 4),
      ],
      patterns: [],
      workflows: [],
    },
    0
  );
});

afterEach(async () => {
  writeFileSync(configPath, originalConfig);
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

it("previews groups without changing the stored profile", async () => {
  const before = await categories();
  expect(await runProfileCleanupCategoriesCommand([], print, deps)).toBe(0);
  expect(output).toContain("Categories: 3 -> 2");
  expect(
    output.some((line) => line.includes('"Execution" <- "Execution" (2), "Direct execution" (1)'))
  ).toBe(true);
  expect(output.some((line) => line.includes("not checked by the model"))).toBe(true);
  expect(output).toContain("Preview only. Run again with --yes to apply every group.");
  expect(await categories()).toEqual(before);
});

it("applies every group with --yes and undoes with --undo", async () => {
  expect(await runProfileCleanupCategoriesCommand(["--yes"], print, deps)).toBe(0);
  expect(output).toContain("Renamed 1 items.");
  expect(await categories()).toEqual(["Execution", "Execution", "Execution", "Language"]);
  output = [];
  expect(await runProfileCleanupCategoriesCommand(["--undo"], print, deps)).toBe(0);
  expect(output).toContain("Restored 1 items; 0 not found.");
  expect(await categories()).toEqual(["Execution", "Execution", "Direct execution", "Language"]);
  output = [];
  expect(await runProfileCleanupCategoriesCommand(["--undo"], print, deps)).toBe(0);
  expect(output).toContain("Nothing to undo.");
});

it("refuses unknown options and prints help", async () => {
  expect(await runProfileCleanupCategoriesCommand(["--force"], print, deps)).toBe(1);
  expect(output[0]).toContain("Unknown option --force");
  output = [];
  expect(await runProfileCleanupCategoriesCommand(["--help"], print, deps)).toBe(0);
  expect(output[0]).toContain("Usage: om-memory-system profile-cleanup-categories");
});
