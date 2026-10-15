import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { CONFIG } = await import("../src/config.js");
const { UserProfileManager } = await import("../src/services/user-profile/user-profile-manager.js");
const { previewCategoryCleanup, applyCategoryCleanup, undoCategoryCleanup } =
  await import("../src/services/user-profile/category-cleanup.js");

const USER = "u@example.invalid";
let directory: string;

/** Labels on one circle: names in the same "family" sit 5 degrees apart, families 90 apart. */
const ANGLES: Record<string, number> = {
  Execution: 0,
  "Direct execution": 5,
  "Autonomous execution": 8,
  Language: 90,
  "Communication language": 95,
  Testing: 180,
  "New topic": 270,
};
const embed = async (text: string) => {
  const radians = ((ANGLES[text] ?? 300) * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
};

function item(category: string, index: number) {
  return {
    category,
    description: `Observation ${category} ${index}`,
    confidence: 0.7,
    frequency: index + 1,
    evidence: [`Evidence ${index}`],
    lastSeen: 100 + index,
    centroid: [index, 1],
    anchor: [1, index],
  };
}

function profileData() {
  return {
    preferences: [
      item("Execution", 1),
      item("Execution", 2),
      item("Direct execution", 3),
      item("Autonomous execution", 4),
      item("Language", 5),
      item("Communication language", 6),
      item("Testing", 7),
    ],
    patterns: [item("Direct execution", 8), item("Communication language", 9)],
    workflows: [],
  };
}

async function setup(data = profileData()) {
  CONFIG.storagePath = directory;
  const manager = new UserProfileManager();
  const id = await manager.createProfile(USER, "U", "u", USER, data, 0);
  const deps = { manager, embed, model: null };
  return { manager, id, deps };
}

async function stored(manager: InstanceType<typeof UserProfileManager>, id: string) {
  const profile = (await manager.getProfileById(id))!;
  return { profile, data: JSON.parse(profile.profileData) };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-cleanup-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

describe("preview", () => {
  it("leaves the profile unchanged and returns groups and counts", async () => {
    const { manager, id, deps } = await setup();
    const before = await stored(manager, id);
    const preview = (await previewCategoryCleanup(USER, deps))!;
    const after = await stored(manager, id);
    expect(after.profile.version).toBe(before.profile.version);
    expect(after.data).toEqual(before.data);
    expect(preview.groups.map((group) => group.labels.map((entry) => entry.label))).toEqual([
      ["Direct execution", "Execution", "Autonomous execution"],
      ["Communication language", "Language"],
    ]);
    expect(preview.before).toBe(6);
    expect(preview.after).toBe(3);
  });
});

describe("apply", () => {
  it("renames only accepted groups and keeps every other field", async () => {
    const { manager, id, deps } = await setup();
    const preview = (await previewCategoryCleanup(USER, deps))!;
    const before = await stored(manager, id);
    const result = await applyCategoryCleanup(
      USER,
      {
        groups: [{ labels: preview.groups[0]!.labels.map((e) => e.label), name: "working style" }],
      },
      deps
    );
    expect(result).toEqual({ ok: true, renamed: 5 });
    const after = await stored(manager, id);
    const categories = [...after.data.preferences, ...after.data.patterns].map(
      (entry: any) => entry.category
    );
    expect(categories).toEqual([
      "Working style",
      "Working style",
      "Working style",
      "Working style",
      "Language",
      "Communication language",
      "Testing",
      "Working style",
      "Communication language",
    ]);
    const strip = (entry: any) => ({ ...entry, category: undefined });
    expect(after.data.preferences.map(strip)).toEqual(before.data.preferences.map(strip));
    expect(after.data.patterns.map(strip)).toEqual(before.data.patterns.map(strip));
    const changes = await manager.getProfileChangelogs(id);
    expect(
      changes.filter((entry) => entry.changeSummary.startsWith("Category cleanup:"))
    ).toHaveLength(1);
  });

  it("applies after learning saved a new version since the preview", async () => {
    const { manager, id, deps } = await setup();
    await previewCategoryCleanup(USER, deps);
    const versionAtPreview = (await stored(manager, id)).profile.version;
    await manager.updateProfile(id, profileData(), 0, "Learning");
    const result = await applyCategoryCleanup(
      USER,
      { groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }] },
      deps
    );
    expect(result).toEqual({ ok: true, renamed: 2 });
    expect((await stored(manager, id)).profile.version).toBe(versionAtPreview + 2);
  });

  it("renames an item that learning added after the preview and keeps its content", async () => {
    const { manager, id, deps } = await setup();
    await previewCategoryCleanup(USER, deps);
    const learned = profileData();
    learned.preferences.push(item("Direct execution", 30));
    learned.preferences.push(item("New topic", 31));
    await manager.updateProfile(id, learned, 0, "Learning");
    const result = await applyCategoryCleanup(
      USER,
      { groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }] },
      deps
    );
    expect(result).toEqual({ ok: true, renamed: 3 });
    const added = (await stored(manager, id)).data.preferences.filter(
      (entry: any) => entry.description === "Observation Direct execution 30"
    );
    expect(added).toEqual([{ ...item("Direct execution", 30), category: "Execution" }]);
    const topics = (await stored(manager, id)).data.preferences.map((entry: any) => entry.category);
    expect(topics).toContain("New topic");
  });

  it("renames nothing and writes no changelog entry when the labels are gone", async () => {
    const { manager, id, deps } = await setup();
    await previewCategoryCleanup(USER, deps);
    const learned = profileData();
    learned.preferences = learned.preferences.filter((entry) => entry.category === "Testing");
    learned.patterns = [];
    await manager.updateProfile(id, learned, 0, "Learning");
    const before = await manager.getProfileChangelogs(id);
    const result = await applyCategoryCleanup(
      USER,
      { groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }] },
      deps
    );
    expect(result).toEqual({ ok: true, renamed: 0 });
    expect((await manager.getProfileChangelogs(id)).length).toBe(before.length);
  });

  it("refuses when a save lands between the read and the write, and keeps that save", async () => {
    const { manager, id, deps } = await setup();
    const racing = Object.create(manager) as typeof manager;
    racing.getActiveProfile = async (userId: string) => {
      const profile = await manager.getActiveProfile(userId);
      await manager.updateProfile(id, profileData(), 0, "Learning during apply");
      return profile;
    };
    const result = await applyCategoryCleanup(
      USER,
      { groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }] },
      { ...deps, manager: racing }
    );
    expect(result).toEqual({ ok: false, error: "stale" });
    const after = await stored(manager, id);
    expect(after.profile.version).toBe(2);
    expect(after.data.preferences[0].category).toBe("Execution");
    expect(after.data.preferences[2].category).toBe("Direct execution");
  });
});

describe("undo", () => {
  async function cleanup12() {
    const data = profileData();
    data.preferences = Array.from({ length: 6 }, (_, index) => item("Execution", index)).concat(
      Array.from({ length: 6 }, (_, index) => item("Direct execution", index + 6))
    );
    data.patterns = [];
    const context = await setup(data);
    await applyCategoryCleanup(
      USER,
      {
        groups: [{ labels: ["Execution", "Direct execution"], name: "Execution style" }],
      },
      context.deps
    );
    return context;
  }

  it("restores items that still exist and leaves later items alone", async () => {
    const { manager, id, deps } = await cleanup12();
    const current = (await stored(manager, id)).data;
    current.preferences = current.preferences.slice(2);
    current.preferences.push(
      ...Array.from({ length: 5 }, (_, index) => item("New topic", 20 + index))
    );
    await manager.updateProfile(id, current, 0, "Learning");
    const result = await undoCategoryCleanup(USER, deps);
    expect(result).toEqual({ ok: true, restored: 10, notFound: 2 });
    const after = (await stored(manager, id)).data.preferences.map((entry: any) => entry.category);
    expect(after.filter((label: string) => label === "New topic")).toHaveLength(5);
    expect(after.filter((label: string) => label === "Execution")).toHaveLength(4);
    expect(after.filter((label: string) => label === "Direct execution")).toHaveLength(6);
    expect(after).not.toContain("Execution style");
  });

  it("stores hashes, not memory text, in the undo record", async () => {
    await cleanup12();
    const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
    const rows = await db.all("SELECT renames FROM profile_category_cleanups");
    expect(rows).toHaveLength(1);
    const text = String(rows[0]!.renames);
    expect(text).not.toContain("Observation");
    expect(JSON.parse(text)[0].descriptionSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports nothing to undo and writes no changelog entry", async () => {
    const { manager, id, deps } = await setup();
    const count = (await manager.getProfileChangelogs(id)).length;
    expect(await undoCategoryCleanup(USER, deps)).toEqual({ ok: false, error: "nothing_to_undo" });
    expect((await manager.getProfileChangelogs(id)).length).toBe(count);
  });

  it("undoes the newest cleanup first, then the next older one", async () => {
    const { manager, id, deps } = await setup();
    const apply = async (labels: string[], name: string) => {
      await applyCategoryCleanup(USER, { groups: [{ labels, name }] }, deps);
    };
    await apply(["Execution", "Direct execution", "Autonomous execution"], "Execution style");
    await apply(["Language", "Communication language"], "Language style");
    const labels = async () =>
      new Set(
        [
          ...(await stored(manager, id)).data.preferences,
          ...(await stored(manager, id)).data.patterns,
        ].map((entry: any) => entry.category)
      );
    expect(await undoCategoryCleanup(USER, deps)).toEqual({ ok: true, restored: 3, notFound: 0 });
    expect(await labels()).toEqual(
      new Set(["Execution style", "Language", "Communication language", "Testing"])
    );
    expect(await undoCategoryCleanup(USER, deps)).toEqual({ ok: true, restored: 5, notFound: 0 });
    expect(await labels()).toEqual(
      new Set([
        "Execution",
        "Direct execution",
        "Autonomous execution",
        "Language",
        "Communication language",
        "Testing",
      ])
    );
    expect(await undoCategoryCleanup(USER, deps)).toEqual({ ok: false, error: "nothing_to_undo" });
  });
});
