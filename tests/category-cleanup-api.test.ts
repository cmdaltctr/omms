import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

let directory: string;
const userId = "category-cleanup-api@example.invalid";
const embed = async (text: string) => (text.includes("xecution") ? [1, 0.05] : [0, 1]);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-cleanup-api-"));
});

afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
});

/** The live config module, as the route host passes it. */
const live = () => import("../src/config.js");

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  CONFIG.userEmailOverride = userId;
  const { userProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  userProfileManager.reset();
  const item = (category: string, index: number) => ({
    category,
    description: `Observation ${index}`,
    confidence: 0.7,
    frequency: 1,
    evidence: ["Evidence"],
    lastSeen: 123,
  });
  await userProfileManager.createProfile(
    userId,
    "Test",
    "test",
    userId,
    {
      preferences: [item("Execution", 1), item("Direct execution", 2), item("Language", 3)],
      patterns: [],
      workflows: [],
    },
    0
  );
  return import("../src/services/api-handlers.js");
}

it("starts a preview job, reads its state, applies and undoes through the handlers", async () => {
  const api = await setup();
  const deps = { embed, model: null };
  const started = await api.handleCategoryCleanupStart(await live(), undefined, deps);
  expect(started.success).toBe(true);
  let status = await api.handleCategoryCleanupStatus(await live(), undefined);
  for (let i = 0; i < 200 && status.data?.status.state !== "done"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    status = await api.handleCategoryCleanupStatus(await live(), undefined);
  }
  const preview = status.data!.status.preview;
  expect(preview.before).toBe(3);
  expect(preview.groups).toHaveLength(1);
  const group = preview.groups[0]!;
  // Equal counts: the fallback name is the first label alphabetically, so one item is renamed.
  expect(group.name).toBe("Direct execution");
  const applied = await api.handleCategoryCleanupApply(
    await live(),
    undefined,
    {
      groups: [{ labels: group.labels.map((entry: any) => entry.label), name: group.name }],
    },
    deps
  );
  expect(applied).toEqual({ success: true, data: { renamed: 1 } });
  const undone = await api.handleCategoryCleanupUndo(await live(), undefined, deps);
  expect(undone).toEqual({ success: true, data: { restored: 1, notFound: 0 } });
  // Apply and undo forget the finished preview, so the next open builds a fresh one.
  expect(await api.handleCategoryCleanupStatus(await live(), undefined)).toEqual({
    success: true,
    data: null,
  });
});

it("reports no job before one is started", async () => {
  const api = await setup();
  expect(
    await api.handleCategoryCleanupStatus(await live(), "someone-else@example.invalid")
  ).toEqual({
    success: true,
    data: null,
  });
});

it("tells the user to try again when a save lands while applying", async () => {
  const api = await setup();
  const { userProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  const racing = Object.create(userProfileManager) as typeof userProfileManager;
  racing.getActiveProfile = async (user: string) => {
    const profile = await userProfileManager.getActiveProfile(user);
    await userProfileManager.updateProfile(
      profile!.id,
      JSON.parse(profile!.profileData),
      0,
      "Learning during apply",
      profile!.version
    );
    return profile;
  };
  const result = await api.handleCategoryCleanupApply(
    await live(),
    undefined,
    { groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }] },
    { embed, model: null, manager: racing }
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain("Try Apply again");
});

it("applies a request that still carries the old version field", async () => {
  const api = await setup();
  const result = await api.handleCategoryCleanupApply(
    await live(),
    undefined,
    {
      version: 999,
      groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }],
    },
    { embed, model: null }
  );
  expect(result.success).toBe(true);
});

it("reports nothing to undo", async () => {
  const api = await setup();
  const result = await api.handleCategoryCleanupUndo(await live(), undefined, {
    embed,
    model: null,
  });
  expect(result).toEqual({ success: false, error: "Nothing to undo." });
});

it("resolves the default user from the config module it is given, on every call", async () => {
  const api = await setup();
  await api.handleCategoryCleanupStart(await live(), undefined, { embed, model: null });
  const other = { CONFIG: { userEmailOverride: "someone-else@example.invalid" } };
  // Same call, two modules: the user comes from the module, so only the first finds the job.
  expect((await api.handleCategoryCleanupStatus(await live(), undefined)).data).not.toBeNull();
  expect(await api.handleCategoryCleanupStatus(other, undefined)).toEqual({
    success: true,
    data: null,
  });
});
