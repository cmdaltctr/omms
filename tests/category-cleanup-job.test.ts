import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { CONFIG } = await import("../src/config.js");
const { UserProfileManager } = await import("../src/services/user-profile/user-profile-manager.js");
const { startCategoryCleanupJob, getCategoryCleanupJob } =
  await import("../src/services/user-profile/category-cleanup-job.js");

let directory: string;
const embed = async (text: string) => (text.includes("xecution") ? [1, 0.05] : [0, 1]);
const item = (category: string, index: number) => ({
  category,
  description: `Observation ${index}`,
  confidence: 0.7,
  frequency: 1,
  evidence: ["Evidence"],
  lastSeen: 123,
});

async function setup(user: string) {
  CONFIG.storagePath = directory;
  const manager = new UserProfileManager();
  await manager.createProfile(
    user,
    "U",
    "u",
    user,
    {
      preferences: [item("Execution", 1), item("Direct execution", 2), item("Language", 3)],
      patterns: [],
      workflows: [],
    },
    0
  );
  return manager;
}

async function settle(user: string) {
  for (let i = 0; i < 200; i++) {
    const job = getCategoryCleanupJob(user)!;
    if (job.status.state === "done" || job.status.state === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-cleanup-job-"));
});

afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
});

it("returns before the model answers, reuses a running job, and ends with the preview", async () => {
  const user = "job-one@example.invalid";
  const manager = await setup(user);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const model = async () => {
    calls++;
    await gate;
    return { groups: [] };
  };
  const first = startCategoryCleanupJob(user, { manager, embed, model });
  expect(["grouping", "checking"]).toContain(first.status.state);
  for (let i = 0; i < 100 && calls === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(getCategoryCleanupJob(user)!.status).toEqual({ state: "checking", done: 0, total: 1 });
  const second = startCategoryCleanupJob(user, { manager, embed, model });
  expect(second.id).toBe(first.id);
  release();
  const job = await settle(user);
  expect(calls).toBe(1);
  expect(job.status.state).toBe("done");
  if (job.status.state === "done") {
    expect(job.status.preview.before).toBe(3);
    expect(job.status.preview.groups).toHaveLength(1);
  }
});

it("starts a fresh job after the last one finished", async () => {
  const user = "job-two@example.invalid";
  const manager = await setup(user);
  const first = startCategoryCleanupJob(user, { manager, embed, model: null });
  await settle(user);
  const second = startCategoryCleanupJob(user, { manager, embed, model: null });
  expect(second.id).not.toBe(first.id);
  await settle(user);
});

it("ends in the failed state with a message when the preview throws", async () => {
  const user = "job-three@example.invalid";
  const manager = await setup(user);
  startCategoryCleanupJob(user, {
    manager,
    embed: async () => {
      throw new Error("embedding server unreachable");
    },
    model: null,
  });
  const job = await settle(user);
  expect(job.status).toEqual({ state: "failed", error: "embedding server unreachable" });
});

it("fails with a clear message when there is no profile", async () => {
  CONFIG.storagePath = directory;
  startCategoryCleanupJob("nobody@example.invalid", {
    manager: new UserProfileManager(),
    embed,
    model: null,
  });
  const job = await settle("nobody@example.invalid");
  expect(job.status).toEqual({ state: "failed", error: "No profile found to clean up" });
});
