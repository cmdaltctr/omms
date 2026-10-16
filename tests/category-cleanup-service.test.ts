import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const logged: unknown[][] = [];
mock.module("../src/services/logger.js", () => ({
  log: (...args: unknown[]) => {
    logged.push(args);
  },
}));

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
  await cleanupTursoTestDirectory(directory);
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

describe("preview with saved model answers", () => {
  const FAMILIES = 45;
  /** Family i uses axis i, so families are far apart and its two names sit close together. */
  const wideEmbed = async (text: string) => {
    const match = /^Fam(\d+) ([ab])$/.exec(text);
    const vector = new Array(2 * FAMILIES + 10).fill(0);
    if (!match) return vector;
    vector[Number(match[1])] = 1;
    if (match[2] === "b") vector[FAMILIES + 5 + Number(match[1])] = 0.1;
    return vector;
  };
  const familyItems = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, offset) => from + offset).flatMap((family) => [
      item(`Fam${family} a`, family),
      item(`Fam${family} b`, family + 100),
    ]);
  const wideProfile = (families: number) => ({
    preferences: familyItems(0, families),
    patterns: [],
    workflows: [],
  });
  /** A model that keeps every name and counts the groups it is asked about, call by call. */
  const countingModel = (asked: string[][], failOnCall?: number) => {
    let call = 0;
    return async (_system: string, prompt: string) => {
      const payload = JSON.parse(prompt.split("Groups:\n")[1]!.split("\n\nReturn JSON")[0]!);
      asked.push(payload.map((entry: any) => entry.group));
      if (++call === failOnCall) throw new Error("timeout");
      return {
        groups: payload.map((entry: any) => ({
          group: entry.group,
          keep: entry.labels.map((label: any) => label.name),
          name: entry.labels[0].name,
        })),
      };
    };
  };

  it("asks the model only about the groups that learning added", async () => {
    const { manager, id } = await setup(wideProfile(FAMILIES));
    const first: string[][] = [];
    const firstPreview = (await previewCategoryCleanup(USER, {
      manager,
      embed: wideEmbed,
      model: countingModel(first),
    }))!;
    expect(firstPreview.groups).toHaveLength(FAMILIES);
    expect(first.map((batch) => batch.length)).toEqual([20, 20, 5]);

    await manager.updateProfile(
      id,
      wideProfile(FAMILIES + 1),
      0,
      "Learning",
      (await stored(manager, id)).profile.version
    );
    const second: string[][] = [];
    const secondPreview = (await previewCategoryCleanup(USER, {
      manager,
      embed: wideEmbed,
      model: countingModel(second),
    }))!;
    expect(second).toHaveLength(1);
    expect(second[0]).toHaveLength(1);
    expect(secondPreview.groups).toHaveLength(FAMILIES + 1);
    expect(secondPreview.groups.every((group) => group.checked)).toBe(true);
  });

  it("retries only the groups of the batch that failed", async () => {
    const { manager } = await setup(wideProfile(FAMILIES));
    const first: string[][] = [];
    const failed = (await previewCategoryCleanup(USER, {
      manager,
      embed: wideEmbed,
      model: countingModel(first, 2),
    }))!;
    expect(failed.groups.filter((group) => !group.checked)).toHaveLength(20);

    const second: string[][] = [];
    const retried = (await previewCategoryCleanup(USER, {
      manager,
      embed: wideEmbed,
      model: countingModel(second),
    }))!;
    expect(second).toEqual([first[1]!]);
    expect(retried.groups.every((group) => group.checked)).toBe(true);
  });

  it("asks again about answers older than 30 days and deletes the old ones", async () => {
    const { manager } = await setup(wideProfile(5));
    await previewCategoryCleanup(USER, { manager, embed: wideEmbed, model: countingModel([]) });
    const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await db.execute("UPDATE profile_category_verdicts SET created_at = ?", [old]);

    const asked: string[][] = [];
    await previewCategoryCleanup(USER, {
      manager,
      embed: wideEmbed,
      model: countingModel(asked),
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(5);
    const rows = await db.all("SELECT created_at FROM profile_category_verdicts");
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => Number(row.created_at) > old + 1000)).toBe(true);
  });

  it("logs reuse counts and phase times, never label text", async () => {
    const { manager } = await setup(wideProfile(5));
    const deps = { manager, embed: wideEmbed, model: countingModel([]) };
    await previewCategoryCleanup(USER, deps);
    logged.length = 0;
    await previewCategoryCleanup(USER, deps);
    const built = logged.find((entry) => entry[0] === "category cleanup: preview built")!;
    expect(built[1]).toMatchObject({ labels: 10, groups: 5, reusedGroups: 5, sentGroups: 0 });
    for (const key of ["embedMs", "groupMs", "checkMs"]) {
      expect(typeof (built[1] as Record<string, unknown>)[key]).toBe("number");
    }
    expect(JSON.stringify(logged)).not.toContain("Fam");
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
    await manager.updateProfile(id, profileData(), 0, "Learning", versionAtPreview);
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
    await manager.updateProfile(
      id,
      learned,
      0,
      "Learning",
      (await stored(manager, id)).profile.version
    );
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
    await manager.updateProfile(
      id,
      learned,
      0,
      "Learning",
      (await stored(manager, id)).profile.version
    );
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
      await manager.updateProfile(id, profileData(), 0, "Learning during apply", profile!.version);
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
    await manager.updateProfile(
      id,
      current,
      0,
      "Learning",
      (await stored(manager, id)).profile.version
    );
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
