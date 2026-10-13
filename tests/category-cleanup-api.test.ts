import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");

let directory: string;
const userId = "category-cleanup-api@example.invalid";
const embed = async (text: string) => (text.includes("xecution") ? [1, 0.05] : [0, 1]);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-cleanup-api-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

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

it("previews, applies and undoes through the handlers", async () => {
  const api = await setup();
  const deps = { embed, model: null };
  const preview = await api.handleCategoryCleanupPreview(undefined, deps);
  expect(preview.success).toBe(true);
  expect(preview.data!.before).toBe(3);
  expect(preview.data!.groups).toHaveLength(1);
  const group = preview.data!.groups[0]!;
  const applied = await api.handleCategoryCleanupApply(
    undefined,
    {
      version: preview.data!.version,
      groups: [{ labels: group.labels.map((entry: any) => entry.label), name: group.name }],
    },
    deps
  );
  // Equal counts: the fallback name is the first label alphabetically, so one item is renamed.
  expect(group.name).toBe("Direct execution");
  expect(applied).toEqual({ success: true, data: { renamed: 1 } });
  const undone = await api.handleCategoryCleanupUndo(undefined, deps);
  expect(undone).toEqual({ success: true, data: { restored: 1, notFound: 0 } });
});

it("refuses a stale apply with a message to build a new preview", async () => {
  const api = await setup();
  const result = await api.handleCategoryCleanupApply(
    undefined,
    { version: 999, groups: [{ labels: ["Execution", "Direct execution"], name: "Execution" }] },
    { embed, model: null }
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain("new preview");
});

it("reports nothing to undo", async () => {
  const api = await setup();
  const result = await api.handleCategoryCleanupUndo(undefined, { embed, model: null });
  expect(result).toEqual({ success: false, error: "Nothing to undo." });
});
