import { afterAll, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TursoDb } from "../src/services/turso/turso-db.js";

const sandbox = mkdtempSync(join(tmpdir(), "omms-learning-order-"));
const originalHome = process.env.HOME;
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;

const { UserPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const { isTrivialPrompt } = await import("../src/core/trivial-prompt.js");

afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

type Manager = InstanceType<typeof UserPromptManager> & { ready(): Promise<TursoDb> };
const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 30);

async function seed(prompts: Array<[string, number]>): Promise<Manager> {
  const manager = new UserPromptManager() as Manager;
  const db = await manager.ready();
  await db.run("DELETE FROM user_prompts");
  for (const [index, [content, createdAt]] of prompts.entries()) {
    const id = await manager.savePrompt("s", `m${index}`, "/p", content);
    await db.run("UPDATE user_prompts SET created_at = ? WHERE id = ?", [createdAt, id]);
  }
  return manager;
}

it("treats short replies as trivial and keeps short preferences", () => {
  expect(isTrivialPrompt("yes go")).toBe(true);
  expect(isTrivialPrompt("  ok  ")).toBe(true);
  expect(isTrivialPrompt("use bun not npm")).toBe(false);
  expect(isTrivialPrompt("Please refactor the settings page")).toBe(false);
});

it("marks trivial waiting prompts learned so they do not count toward the interval", async () => {
  const manager = await seed([
    ["yes go", now],
    ["use bun not npm", now],
    ["continue", now],
  ]);
  expect(await manager.skipTrivialPromptsForLearning()).toBe(2);
  expect(await manager.countUnanalyzedForUserLearning()).toBe(1);
  const batch = await manager.getPromptsForUserLearning(10);
  expect(batch.map((prompt) => prompt.content)).toEqual(["use bun not npm"]);
});

it("takes recent prompts newest first, and falls back to the oldest", async () => {
  const manager = await seed([
    ["old backlog prompt one", now - 40 * DAY],
    ["old backlog prompt two", now - 30 * DAY],
    ["recent prompt one today", now - 2 * DAY],
    ["recent prompt two today", now - DAY],
  ]);
  const recent = await manager.getPromptsForUserLearning(10, { recentFirst: true, now });
  expect(recent.map((prompt) => prompt.content)).toEqual([
    "recent prompt two today",
    "recent prompt one today",
  ]);
  await manager.markMultipleAsUserLearningCaptured(recent.map((prompt) => prompt.id));
  const fallback = await manager.getPromptsForUserLearning(10, { recentFirst: true, now });
  expect(fallback.map((prompt) => prompt.content)).toEqual([
    "old backlog prompt one",
    "old backlog prompt two",
  ]);
});

it("counts waiting trivial prompts without marking them", async () => {
  const manager = await seed([
    ["yes go", now],
    ["use bun not npm", now],
    ["ok", now],
  ]);
  expect(await manager.countTrivialPromptsForLearning()).toBe(2);
  expect(await manager.countUnanalyzedForUserLearning()).toBe(3);
});
