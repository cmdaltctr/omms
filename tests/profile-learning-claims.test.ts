import { afterAll, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Batch claims (design D5 of unify-profile-learning): a live pass and a
// catch-up run claim their prompts, so two runs never analyse the same prompt.

const sandbox = mkdtempSync(join(tmpdir(), "omms-learning-claims-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;

const { CONFIG } = await import("../src/config.js");
const { UserPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const { drainProfileBacklog } = await import("../src/importer/profile-backlog.js");

afterAll(async () => {
  try {
    await cleanupTursoTestDirectory(sandbox);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  }
});

type Manager = InstanceType<typeof UserPromptManager>;
const MINUTE = 60_000;
const now = Date.now();
let storeCount = 0;

/** A fresh store in its own folder, with `count` waiting prompts, oldest first. */
async function seed(count: number): Promise<{ manager: Manager; dbPath: string }> {
  const dir = join(sandbox, `store-${storeCount++}`);
  CONFIG.storagePath = dir;
  const manager = new UserPromptManager() as Manager;
  for (let index = 0; index < count; index++) {
    await manager.savePrompt("s", `m${index}`, "/p", `Waiting prompt number ${index} about work`);
  }
  return { manager, dbPath: join(dir, "user-prompts.db") };
}

const ids = (prompts: Array<{ id: string }>) => prompts.map((prompt) => prompt.id).sort();
const reply = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
const user = { userEmail: "me@example.invalid" };
const profileStore = {
  getActiveProfile: async () => null,
  createProfile: async () => "profile",
} as never;

it("keeps a claimed prompt from a second pass", async () => {
  const { manager } = await seed(3);
  const first = await manager.getPromptsForUserLearning(10, { claim: true, now });
  expect(first).toHaveLength(3);
  expect(await manager.getPromptsForUserLearning(10, { claim: true, now })).toEqual([]);
  expect(await manager.getPromptsForUserLearning(10, { recentFirst: true, now })).toEqual([]);
  // Claimed prompts still count toward the interval.
  expect(await manager.countUnanalyzedForUserLearning()).toBe(3);
});

it("frees a claim on release and clears it when the prompts are learned", async () => {
  const { manager, dbPath } = await seed(4);
  const batch = await manager.getPromptsForUserLearning(2, { claim: true, now });
  const rest = await manager.getPromptsForUserLearning(10, { claim: true, now });
  expect(ids(rest)).not.toContain(batch[0]!.id);
  expect(rest).toHaveLength(2);

  await manager.markForUserLearning(batch.map((prompt) => prompt.id));
  expect(ids(await manager.getPromptsForUserLearning(10, { claim: true, now }))).toEqual(
    ids(batch)
  );

  await manager.markMultipleAsUserLearningCaptured([...batch, ...rest].map((prompt) => prompt.id));
  const db = createClient({ url: `file:${dbPath}` });
  const held = await db.execute(
    "SELECT COUNT(*) AS count FROM user_prompts WHERE user_learning_claimed_at IS NOT NULL"
  );
  db.close();
  expect(Number(held.rows[0]!.count)).toBe(0);
});

it("treats a claim older than 10 minutes as free", async () => {
  const { manager } = await seed(10);
  const claimedAt = now - 11 * MINUTE;
  expect(await manager.getPromptsForUserLearning(10, { claim: true, now: claimedAt })).toHaveLength(
    10
  );
  expect(
    await manager.getPromptsForUserLearning(10, { claim: true, now: claimedAt + 5 * MINUTE })
  ).toEqual([]);
  expect(await manager.getPromptsForUserLearning(10, { claim: true, now })).toHaveLength(10);
});

it("never lets a catch-up run and a live pass take the same prompt", async () => {
  const { manager } = await seed(55);
  const drained: string[] = [];
  let live: string[] = [];
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete() {
      // A live pass starts while the catch-up batch waits for the model.
      if (live.length === 0)
        live = ids(await manager.getPromptsForUserLearning(10, { recentFirst: true, claim: true }));
      return reply;
    },
  };
  const original = manager.markMultipleAsUserLearningCaptured.bind(manager);
  const promptStore = Object.assign(Object.create(manager), {
    markMultipleAsUserLearningCaptured: async (batch: string[]) => {
      drained.push(...batch);
      await original(batch);
    },
  });
  await drainProfileBacklog({ user, model, promptStore, profileStore, batchSize: 50 });
  expect(drained).toHaveLength(50);
  expect(live).toHaveLength(5);
  expect(live.filter((id) => drained.includes(id))).toEqual([]);
});

it("releases the claim of a catch-up batch that fails", async () => {
  const { manager } = await seed(5);
  let seenDuringFailure: string[] | null = null;
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete(): Promise<string> {
      seenDuringFailure ??= ids(await manager.getPromptsForUserLearning(10, { now }));
      throw new Error("request timeout");
    },
  };
  const report = await drainProfileBacklog({
    user,
    model,
    promptStore: manager,
    profileStore,
    batchSize: 50,
  });
  expect(report.reason).toBe("timeout");
  // The failing batch held its claim during the model call ...
  expect(seenDuringFailure!).toEqual([]);
  // ... and released it when the batch failed.
  expect(await manager.getPromptsForUserLearning(10, { claim: true, now })).toHaveLength(5);
});

it("adds the claim column to an old store and keeps its prompts", async () => {
  const dir = join(sandbox, "old-store");
  const dbPath = join(dir, "user-prompts.db");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const legacy = createClient({ url: `file:${dbPath}` });
  await legacy.batch(
    [
      `CREATE TABLE user_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        project_path TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        captured INTEGER DEFAULT 0,
        user_learning_captured BOOLEAN DEFAULT 0,
        linked_memory_id TEXT,
        capture_attempts INTEGER DEFAULT 0,
        provider_id TEXT,
        model_id TEXT
      )`,
      {
        sql: `INSERT INTO user_prompts (id, session_id, message_id, project_path, content, created_at, captured, user_learning_captured)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["prompt_old_waiting", "s", "m1", "/p", "an old waiting prompt", 100, 1, 0],
      },
      {
        sql: `INSERT INTO user_prompts (id, session_id, message_id, project_path, content, created_at, captured, user_learning_captured)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["prompt_old_learned", "s", "m2", "/p", "an old learned prompt", 200, 1, 1],
      },
    ],
    "write"
  );
  legacy.close();

  CONFIG.storagePath = dir;
  const manager = new UserPromptManager() as Manager;
  expect((await manager.getPromptById("prompt_old_learned"))?.content).toBe(
    "an old learned prompt"
  );
  const batch = await manager.getPromptsForUserLearning(10, { claim: true, now });
  expect(batch.map((prompt) => prompt.content)).toEqual(["an old waiting prompt"]);

  const verify = createClient({ url: `file:${dbPath}` });
  const columns = await verify.execute("PRAGMA table_info(user_prompts)");
  const rows = await verify.execute("SELECT COUNT(*) AS count FROM user_prompts");
  verify.close();
  expect(columns.rows.map((row) => String(row.name))).toContain("user_learning_claimed_at");
  expect(Number(rows.rows[0]!.count)).toBe(2);
});
