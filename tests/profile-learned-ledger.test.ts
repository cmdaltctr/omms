import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// A saved batch is never learned twice, even after a restart. The profile save records the
// batch's prompt ids in the profile database in the same write, so the record exists exactly
// when the save landed. Every store here is real, in its own temp folder; only the model and
// the failing mark are stand-ins.

const sandbox = mkdtempSync(join(tmpdir(), "omms-learned-ledger-"));
const { CONFIG } = await import("../src/config.js");
const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const { userProfileManager, UserProfileManager } =
  await import("../src/services/user-profile/user-profile-manager.js");
const { getTags } = await import("../src/services/tags.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");
const pass = await import("../src/core/profile-learning/pass.js");
const { importProfileFromHistory } = await import("../src/importer/profile-import.js");

type HostName = "pi" | "opencode" | "claude-code";
const hosts: HostName[] = ["pi", "opencode", "claude-code"];
const empty = { preferences: [], patterns: [], workflows: [] };
const savedPath = CONFIG.storagePath;
let folders = 0;
let dir = "";

/** A fresh, empty storage folder, made the active one. */
async function useFolder(): Promise<string> {
  const folder = join(sandbox, `space-${folders++}`);
  mkdirSync(folder, { recursive: true });
  CONFIG.storagePath = folder;
  await resetStoreHandles();
  return folder;
}

/** Reads a table through a second, raw libSQL client, so the test does not trust the store. */
async function rawRows(folder: string, file: string, sql: string) {
  const client = createClient({ url: `file:${join(folder, file)}` });
  try {
    return (await client.execute(sql)).rows as unknown as Record<string, unknown>[];
  } finally {
    client.close();
  }
}

async function rawRun(folder: string, file: string, sql: string): Promise<void> {
  const client = createClient({ url: `file:${join(folder, file)}` });
  try {
    await client.execute(sql);
  } finally {
    client.close();
  }
}

const ledgerRows = (folder: string) =>
  rawRows(folder, "user-profiles.db", "SELECT * FROM learned_prompts");

function countingModel(counter: { calls: number }) {
  return {
    provider: "stub",
    modelId: "stub",
    async complete() {
      counter.calls++;
      return JSON.stringify(empty);
    },
  };
}

function runPass(host: HostName, model: unknown) {
  return pass.runProfileLearningPass({
    host,
    directory: dir,
    config: {
      userProfileAnalysisInterval: 5,
      userProfileMaxContextBytes: 32768,
      userProfileWithoutEmail: "learn",
      userProfileDecayBeforeMerge: false,
      userProfilePromptDetail: "prompts-only",
      userProfileValidationEnabled: false,
      showUserProfileToasts: false,
      userProfileDuringCatchUp: "learn",
      userProfileAutoCleanupEnabled: false,
      userProfileAutoCleanupInterval: 500,
    } as never,
    model: () => model as never,
  });
}

beforeEach(async () => {
  dir = await useFolder();
  profileBackoff.recordSuccess();
});

afterEach(async () => {
  CONFIG.storagePath = savedPath;
  await resetStoreHandles();
});

afterAll(async () => {
  await cleanupTursoTestDirectory(sandbox);
});

describe("a saved batch is never learned twice", () => {
  it.each(hosts)(
    "%s: after a restart the next pass marks the saved batch and calls no model",
    async (host) => {
      const userId = getTags(dir).user.userEmail || "unknown";
      await userProfileManager.createProfile(userId, "Me", "me", userId, empty, 0);
      for (let i = 0; i < 5; i++) {
        await userPromptManager.savePrompt("s", `m${i}`, dir, `Please refactor module ${i} now`);
      }
      const model = { calls: 0 };
      const mark = userPromptManager.markMultipleAsUserLearningCaptured;
      // Every mark of the saved batch fails, as a locked user-prompts.db would.
      userPromptManager.markMultipleAsUserLearningCaptured = async (ids: string[]) => {
        if (ids.length > 0) throw new Error("database is locked");
      };
      try {
        expect(await runPass(host, countingModel(model))).toEqual({ outcome: "saved" });
      } finally {
        userPromptManager.markMultipleAsUserLearningCaptured = mark;
      }
      expect(model.calls).toBe(1);

      // A restart: every handle held in memory goes, and the 10-minute claim runs out.
      await resetStoreHandles();
      await rawRun(dir, "user-prompts.db", "UPDATE user_prompts SET user_learning_claimed_at = 1");

      expect((await runPass(host, countingModel(model))).outcome).toBe("skipped");
      expect(model.calls).toBe(1);
      const profile = await userProfileManager.getActiveProfile(userId);
      expect(profile?.version).toBe(2);
      expect(profile?.totalPromptsAnalyzed).toBe(5);
      expect(await userPromptManager.countUnanalyzedForUserLearning()).toBe(0);
      // A successful mark clears the record, so the table stays small.
      expect(await ledgerRows(dir)).toEqual([]);
    }
  );

  it("records a first profile's batch with its creation", async () => {
    const id = await userProfileManager.createProfile("u1", "Me", "me", "u1@x.invalid", empty, 2, [
      "a",
      "b",
    ]);
    expect(await userProfileManager.getLearnedPromptIds(id, ["a", "b", "c"])).toEqual(["a", "b"]);
  });
});

describe("the record is written only with the save", () => {
  const update = (id: string, version: number, ids: string[]) =>
    userProfileManager.updateProfile(id, empty, ids.length, "learn", version, ids);

  it("writes no record when the save meets a newer version", async () => {
    const id = await userProfileManager.createProfile("u1", "Me", "me", "u1@x.invalid", empty, 0);
    expect(await update(id, 99, ["a", "b"])).toBe(false);
    expect(await ledgerRows(dir)).toEqual([]);
    expect((await userProfileManager.getProfileById(id))?.version).toBe(1);
  });

  it("writes no record when the profile write fails", async () => {
    const id = await userProfileManager.createProfile("u1", "Me", "me", "u1@x.invalid", empty, 0);
    await rawRun(
      dir,
      "user-profiles.db",
      "CREATE TRIGGER fail_update BEFORE UPDATE ON user_profiles BEGIN SELECT RAISE(ABORT, 'disk'); END"
    );
    await expect(update(id, 1, ["a", "b"])).rejects.toThrow();
    expect(await ledgerRows(dir)).toEqual([]);
  });

  it("keeps the old profile when the record cannot be written", async () => {
    const id = await userProfileManager.createProfile("u1", "Me", "me", "u1@x.invalid", empty, 0);
    await rawRun(
      dir,
      "user-profiles.db",
      "CREATE TRIGGER fail_ledger BEFORE INSERT ON learned_prompts BEGIN SELECT RAISE(ABORT, 'disk'); END"
    );
    await expect(update(id, 1, ["a"])).rejects.toThrow();
    const profile = await userProfileManager.getProfileById(id);
    expect(profile?.version).toBe(1);
    expect(profile?.totalPromptsAnalyzed).toBe(0);
  });
});

describe("an older profile database", () => {
  it("gains the record table on open and keeps its profile rows", async () => {
    const client = createClient({ url: `file:${join(dir, "user-profiles.db")}` });
    await client.execute(`CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      user_name TEXT NOT NULL, user_email TEXT NOT NULL, profile_data TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
      last_analyzed_at INTEGER NOT NULL, total_prompts_analyzed INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT 1)`);
    await client.execute(
      `INSERT INTO user_profiles VALUES ('old', 'u1', 'Me', 'me', 'u1@x.invalid', ?, 3, 1, 1, 7, 1)`,
      [JSON.stringify(empty)]
    );
    client.close();

    const manager = new UserProfileManager();
    const profile = await manager.getActiveProfile("u1");
    expect(profile).toMatchObject({ id: "old", version: 3, totalPromptsAnalyzed: 7 });
    const tables = await rawRows(
      dir,
      "user-profiles.db",
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'learned_prompts'"
    );
    expect(tables).toHaveLength(1);
    expect(await manager.updateProfile("old", empty, 1, "learn", 3, ["x"])).toBe(true);
    expect(await manager.getLearnedPromptIds("old", ["x", "y"])).toEqual(["x"]);
  });
});

describe("a forced history re-analysis", () => {
  it("sends a prompt to the model again when a record of it was left behind", async () => {
    const project = join(sandbox, `project-${folders++}`);
    mkdirSync(project, { recursive: true });
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "ledger@example.invalid"],
      ["config", "user.name", "Ledger Test"],
    ]) {
      const result = spawnSync("git", args, { cwd: project });
      if (result.status !== 0) throw new Error(result.stderr.toString());
    }
    const source = [
      {
        sessionId: "s",
        directory: project,
        sourceFile: "history.db",
        units: [
          {
            userEntryId: "u",
            userPrompt: "Please refactor the storage module before the release",
            sourceEntryIds: ["a"],
            textResponses: ["Done"],
            toolCalls: [],
          },
        ],
      },
    ];
    const entries = new Map<string, { status: string }>();
    const ledger = {
      get: async (key: string) => entries.get(key) ?? null,
      begin: async ({ key }: { key: string }) => void entries.set(key, { status: "pending" }),
      complete: async (key: string) => void entries.set(key, { status: "imported" }),
    };
    const model = { calls: 0 };
    const run = (force: boolean) =>
      importProfileFromHistory(source, {
        host: "opencode",
        force,
        ledger: ledger as never,
        model: countingModel(model) as never,
      });

    expect((await run(false)).error).toBeUndefined();
    expect(model.calls).toBe(1);
    const [prompt] = await rawRows(dir, "user-prompts.db", "SELECT id FROM user_prompts");
    const profile = await userProfileManager.getActiveProfile("ledger@example.invalid");
    // The mark landed but the record delete failed, so a record of a learned prompt stays.
    await rawRun(
      dir,
      "user-profiles.db",
      `INSERT INTO learned_prompts VALUES ('${profile!.id}', '${String(prompt!.id)}', 1)`
    );

    expect((await run(true)).error).toBeUndefined();
    expect(model.calls).toBe(2);
    expect(await userPromptManager.countUnanalyzedForUserLearning()).toBe(0);
    expect(await ledgerRows(dir)).toEqual([]);
  });
});

describe("a memory space switch", () => {
  it("keeps the record in the active space's profile database", async () => {
    const spaceA = dir;
    const inA = await userProfileManager.createProfile("u1", "Me", "me", "u1@x", empty, 1, ["a1"]);
    expect(await ledgerRows(spaceA)).toHaveLength(1);

    const spaceB = await useFolder();
    expect(await userProfileManager.getLearnedPromptIds(inA, ["a1"])).toEqual([]);
    expect(await ledgerRows(spaceB)).toEqual([]);

    CONFIG.storagePath = spaceA;
    await resetStoreHandles();
    expect(await userProfileManager.getLearnedPromptIds(inA, ["a1"])).toEqual(["a1"]);
  });
});
