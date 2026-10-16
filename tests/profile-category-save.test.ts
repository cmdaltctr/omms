import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

function data(): UserProfileData {
  const item = (category: string, index: number) => ({
    category,
    description: `Observation ${index}`,
    confidence: 0.6,
    frequency: 1,
    evidence: ["Evidence"],
    lastSeen: 123,
    centroid: [1, 0],
    anchor: [1, 0],
  });
  return {
    preferences: [
      "Communication style",
      "communication_style",
      "writing_standards",
      "UI/UX",
      "explicit",
      " ",
    ].map(item),
    patterns: [item("Communication style", 7), item("OpenSpec conventions", 8)],
    workflows: [
      {
        description: "Release",
        steps: ["Branch", "Test", "Release"],
        confidence: 0.6,
        frequency: 2,
        evidence: ["Evidence"],
        lastSeen: 123,
      },
    ],
    learning_paths: [{ topic: "Topic", chain: ["A"], description: "Path" }],
  };
}

function expected(input: UserProfileData): UserProfileData {
  const categories = [
    "Communication style",
    "Communication style",
    "Writing standards",
    "UI/UX",
    "explicit",
    "General",
  ];
  return {
    ...input,
    preferences: input.preferences.map((item, index) => ({
      ...item,
      category: categories[index]!,
    })),
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-save-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

describe("category save paths", () => {
  it("canonicalises creation without changing workflows or other item fields", async () => {
    const manager = await makeManager();
    const input = data();
    const before = structuredClone(input);
    const id = await manager.createProfile(
      "test@example.invalid",
      "Test",
      "test",
      "test@example.invalid",
      input,
      7
    );
    const stored = await manager.getProfileById(id);
    expect(JSON.parse(stored!.profileData)).toEqual(expected(before));
    expect(input).toEqual(before);
    expect(stored!.totalPromptsAnalyzed).toBe(7);
  });

  it("canonicalises updates and keeps manually shortened workflows", async () => {
    const manager = await makeManager();
    const id = await manager.createProfile(
      "test@example.invalid",
      "Test",
      "test",
      "test@example.invalid",
      { preferences: [], patterns: [], workflows: [] },
      7
    );
    const input = data();
    input.workflows[0]!.steps = ["One manually edited step"];
    const before = structuredClone(input);
    const version = (await manager.getProfileById(id))!.version;
    expect(await manager.updateProfile(id, input, 0, "Manual edit", version)).toBe(true);
    const stored = await manager.getProfileById(id);
    expect(JSON.parse(stored!.profileData)).toEqual(expected(before));
    expect(input).toEqual(before);
    expect(stored!.totalPromptsAnalyzed).toBe(7);
    const changes = await manager.getProfileChangelogs(id);
    expect(JSON.parse(changes[0]!.profileDataSnapshot)).toEqual(expected(before));
  });

  it("keeps the reserved explicit label on creation and update against Explicit variants", async () => {
    const manager = await makeManager();
    const variants = (): UserProfileData => {
      const input = data();
      input.preferences = ["Explicit", "Explicit", "explicit"].map((category, index) => ({
        ...input.preferences[0]!,
        category,
        description: `Observation ${index}`,
      }));
      input.patterns = ["Explicit", "Explicit"].map((category, index) => ({
        ...input.patterns[0]!,
        category,
        description: `Pattern ${index}`,
      }));
      return input;
    };
    const categories = async (id: number | string) => {
      const stored = JSON.parse((await manager.getProfileById(id as string))!.profileData);
      return [...stored.preferences, ...stored.patterns].map(
        (entry: { category: string }) => entry.category
      );
    };
    const created = variants();
    const id = await manager.createProfile(
      "test@example.invalid",
      "Test",
      "test",
      "test@example.invalid",
      created,
      7
    );
    expect(await categories(id)).toEqual(Array(5).fill("explicit"));
    const version = (await manager.getProfileById(id))!.version;
    expect(await manager.updateProfile(id, variants(), 0, "Manual edit", version)).toBe(true);
    expect(await categories(id)).toEqual(Array(5).fill("explicit"));
  });
});
