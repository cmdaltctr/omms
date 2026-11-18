import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the user prompt store and the catch-up lease (storage port slice S10).
// It pins what both do today so the move into src/services/storage/ cannot change it: reads,
// writes, a space switch, the reset registration, the schema upgrade, the profile-learning batch
// claims and the catch-up lease. Every store here is real, in its own temp folder.

const CLAIM_MS = 10 * 60_000;
let baseDir: string;
let otherDir: string;
let savedPath: string;

async function loadConfig() {
  return (await import("../src/config.js")).CONFIG;
}

async function loadStore() {
  return await import("../src/services/storage/user-prompts.js");
}

async function loadLease() {
  return await import("../src/services/storage/profile-catch-up-lease.js");
}

async function switchTo(folder: string): Promise<void> {
  const config = await loadConfig();
  const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
  config.storagePath = folder;
  await resetStoreHandles();
}

/** Runs SQL through a second, raw libSQL client, so the test does not trust the store. */
async function raw(folder: string, sql: string, args: (string | number | null)[] = []) {
  const client = createClient({ url: `file:${join(folder, "user-prompts.db")}` });
  try {
    return (await client.execute({ sql, args })).rows as unknown as Record<string, unknown>[];
  } finally {
    client.close();
  }
}

function fileHash(folder: string): string {
  return createHash("sha256")
    .update(readFileSync(join(folder, "user-prompts.db")))
    .digest("hex");
}

function dbFiles(folder: string): string[] {
  return readdirSync(folder).filter((name) => name.endsWith(".db"));
}

describe("user prompt store (characterisation)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "user-prompts-a-"));
    otherDir = mkdtempSync(join(tmpdir(), "user-prompts-b-"));
    const config = await loadConfig();
    savedPath = config.storagePath;
    await switchTo(baseDir);
  });

  afterEach(async () => {
    const config = await loadConfig();
    config.storagePath = savedPath;
    await cleanupTursoTestDirectory(baseDir);
    await cleanupTursoTestDirectory(otherDir);
  });

  // Tests mock the old paths, so they stay as re-exports of the same store and lease.
  it("keeps the old module paths as re-exports of the same store and lease", async () => {
    const moved = await loadStore();
    const shim = await import("../src/services/user-prompt/user-prompt-manager.js");
    expect(shim.userPromptManager).toBe(moved.userPromptManager);
    expect(shim.UserPromptManager).toBe(moved.UserPromptManager);
    expect(shim.USER_LEARNING_CLAIM_MS).toBe(moved.USER_LEARNING_CLAIM_MS);
    const lease = await loadLease();
    const leaseShim = await import("../src/services/user-prompt/profile-catch-up-lease.js");
    expect(leaseShim.CatchUpLease).toBe(lease.CatchUpLease);
    expect(leaseShim.LEASE_EXPIRY_MS).toBe(lease.LEASE_EXPIRY_MS);
  });

  // (r) read through the public API
  it("reads saved prompts back through the public API", async () => {
    const { userPromptManager: store } = await loadStore();
    const first = await store.savePrompt("s1", "m1", "C:\\work\\proj", "first prompt text");
    // The same session and message returns the first id and adds no row.
    expect(await store.savePrompt("s1", "m1", "/other", "changed")).toBe(first);
    const second = await store.savePrompt("s1", "m2", "C:/work/proj", "second prompt text");
    await store.setPromptModel("m2", "zai", "glm-5");

    const got = await store.getPromptById(second);
    expect(got).toMatchObject({
      id: second,
      sessionId: "s1",
      messageId: "m2",
      projectPath: "C:/work/proj",
      content: "second prompt text",
      captured: false,
      userLearningCaptured: false,
      linkedMemoryId: null,
      capture_attempts: 0,
      providerId: "zai",
      modelId: "glm-5",
    });
    expect(await store.getPromptById("missing")).toBeNull();
    expect(await store.countUncapturedPrompts(3)).toBe(2);
    expect((await store.getUncapturedPromptsForSession("s1", 3)).map((p) => p.id)).toEqual([
      first,
      second,
    ]);

    // A failed attempt moves a prompt past the retry limit.
    await store.recordFailedAttempt(first);
    expect(await store.countUncapturedPrompts(1)).toBe(1);
    expect((await store.getUncapturedPrompts(10, 3)).map((p) => p.id)).toEqual([second, first]);

    // Claim and release.
    expect(await store.claimPrompt(second)).toBe(true);
    expect(await store.claimPrompt(second)).toBe(false);
    expect(await store.releaseClaim(second)).toBe(true);
    expect(await store.releaseClaim(second)).toBe(false);

    await store.markMultipleAsCaptured([first, second]);
    await store.linkMemoryToPrompt(first, "mem-1");
    expect(await store.countUncapturedPrompts(3)).toBe(0);
    // Both spellings of the project folder match.
    expect((await store.getCapturedPrompts("C:/work/proj")).map((p) => p.id).sort()).toEqual(
      [first, second].sort()
    );
    expect((await store.searchPrompts("second", "C:\\work\\proj")).map((p) => p.id)).toEqual([
      second,
    ]);
    expect((await store.getPromptsByIds([first, "missing"])).map((p) => p.id)).toEqual([first]);
    expect(await store.getPromptsByIds([])).toEqual([]);

    expect(await store.updateProjectPath("C:\\work\\proj", "/moved")).toBe(2);
    expect((await store.getPromptById(first))?.projectPath).toBe("/moved");

    // Learning queue counts and the trivial-prompt skip.
    await store.savePrompt("s2", "m3", "/moved", "ok");
    expect(await store.countUnanalyzedForUserLearning()).toBe(3);
    expect(await store.countTrivialPromptsForLearning()).toBe(1);
    expect(await store.skipTrivialPromptsForLearning()).toBe(1);
    expect(await store.countUnanalyzedForUserLearning()).toBe(2);
    await store.markAsUserLearningCaptured(first);
    expect(await store.countUnanalyzedForUserLearning()).toBe(1);
    await store.markForUserLearning([first]);
    expect(await store.countUnanalyzedForUserLearning()).toBe(2);

    const deleted = await store.deleteOldPrompts(Date.now() + 1000);
    expect(deleted).toEqual({ deleted: 3, linkedMemoryIds: ["mem-1"] });
    await store.vacuum();
    expect(await store.getPromptById(first)).toBeNull();
  });

  // (w) write through the API, read back with a raw client
  it("writes the documented columns, indexes and the claim stamp to user-prompts.db", async () => {
    const { userPromptManager: store } = await loadStore();
    const id = await store.savePrompt("w-session", "w-message", "/w", "write me down please");
    await store.setPromptModel("w-message", "openai", "gpt");
    await store.linkMemoryToPrompt(id, "mem-w");
    await store.getPromptsForUserLearning(5, { claim: true, now: 5_000_000 });

    const rows = await raw(baseDir, "SELECT * FROM user_prompts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      session_id: "w-session",
      message_id: "w-message",
      project_path: "/w",
      content: "write me down please",
      captured: 0,
      user_learning_captured: 0,
      linked_memory_id: "mem-w",
      capture_attempts: 0,
      provider_id: "openai",
      model_id: "gpt",
      user_learning_claimed_at: 5_000_000,
    });
    const columns = await raw(baseDir, "PRAGMA table_info(user_prompts)");
    expect(columns.map((c) => c.name)).toEqual([
      "id",
      "session_id",
      "message_id",
      "project_path",
      "content",
      "created_at",
      "captured",
      "user_learning_captured",
      "linked_memory_id",
      "capture_attempts",
      "provider_id",
      "model_id",
      "user_learning_claimed_at",
    ]);
    const indexes = await raw(
      baseDir,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_prompts' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    expect(indexes.map((row) => row.name)).toEqual([
      "idx_user_prompts_captured",
      "idx_user_prompts_created",
      "idx_user_prompts_linked",
      "idx_user_prompts_project",
      "idx_user_prompts_session",
      "idx_user_prompts_user_learning",
    ]);
  });

  // (s) space switch
  it("keeps each space's prompts in its own folder across a switch", async () => {
    const { userPromptManager: store } = await loadStore();
    const inA = await store.savePrompt("s", "a", "/p", "prompt kept in space A");
    await switchTo(otherDir);

    expect(await store.getPromptById(inA)).toBeNull();
    expect(await store.countUnanalyzedForUserLearning()).toBe(0);
    const inB = await store.savePrompt("s", "b", "/p", "prompt kept in space B");
    await switchTo(otherDir);
    const aHashWhileInB = fileHash(baseDir);

    expect(dbFiles(baseDir)).toEqual(["user-prompts.db"]);
    expect(dbFiles(otherDir)).toEqual(["user-prompts.db"]);
    expect((await raw(otherDir, "SELECT id FROM user_prompts")).map((r) => r.id)).toEqual([inB]);

    await switchTo(baseDir);
    expect((await store.getPromptById(inA))?.content).toBe("prompt kept in space A");
    expect(await store.getPromptById(inB)).toBeNull();
    await switchTo(baseDir);
    expect(fileHash(baseDir)).toBe(aHashWhileInB);
  });

  // A batch claim belongs to its space and survives a round trip.
  it("keeps a batch claim in its own space across a switch and back", async () => {
    const { userPromptManager: store } = await loadStore();
    const now = 9_000_000;
    const a1 = await store.savePrompt("s", "a1", "/p", "space A prompt number one");
    const a2 = await store.savePrompt("s", "a2", "/p", "space A prompt number two");
    const claimedA = await store.getPromptsForUserLearning(10, { claim: true, now });
    expect(claimedA.map((p) => p.id).sort()).toEqual([a1, a2].sort());

    await switchTo(otherDir);
    const b1 = await store.savePrompt("s", "b1", "/p", "space B prompt number one");
    // Space B sees only its own prompt, unclaimed, and can claim it at the same moment.
    expect((await store.getPromptsForUserLearning(10, { now })).map((p) => p.id)).toEqual([b1]);
    expect(
      (await store.getPromptsForUserLearning(10, { claim: true, now })).map((p) => p.id)
    ).toEqual([b1]);
    expect(
      (await raw(otherDir, "SELECT user_learning_claimed_at AS at FROM user_prompts")).map(
        (r) => r.at
      )
    ).toEqual([now]);

    await switchTo(baseDir);
    // A's claim is intact: nothing to take, and the stamps are unchanged.
    expect(await store.getPromptsForUserLearning(10, { claim: true, now: now + 1 })).toEqual([]);
    const stamps = await raw(
      baseDir,
      "SELECT id, user_learning_claimed_at AS at FROM user_prompts ORDER BY id"
    );
    expect(stamps.map((r) => r.at)).toEqual([now, now]);
    expect(stamps.map((r) => r.id).sort()).toEqual([a1, a2].sort());
  });

  it("lets a claim older than 10 minutes be claimed again, and not before", async () => {
    const { userPromptManager: store, USER_LEARNING_CLAIM_MS } = await loadStore();
    expect(USER_LEARNING_CLAIM_MS).toBe(CLAIM_MS);
    const now = 20_000_000;
    const id = await store.savePrompt("s", "m", "/p", "a prompt worth learning from");
    expect(
      (await store.getPromptsForUserLearning(5, { claim: true, now })).map((p) => p.id)
    ).toEqual([id]);
    // At exactly 10 minutes the claim still holds.
    expect(await store.getPromptsForUserLearning(5, { claim: true, now: now + CLAIM_MS })).toEqual(
      []
    );
    const later = now + CLAIM_MS + 1;
    expect(
      (await store.getPromptsForUserLearning(5, { claim: true, now: later })).map((p) => p.id)
    ).toEqual([id]);
    expect(
      (await raw(baseDir, "SELECT user_learning_claimed_at AS at FROM user_prompts"))[0]?.at
    ).toBe(later);
    // Learned prompts leave the queue and drop their claim.
    await store.markMultipleAsUserLearningCaptured([id]);
    expect(
      await raw(
        baseDir,
        "SELECT user_learning_captured AS c, user_learning_claimed_at AS at FROM user_prompts"
      )
    ).toEqual([{ c: 1, at: null }]);
  });

  // (h) reset registration and the path after a reset
  it("stays registered as user-prompts and opens the new path after a reset", async () => {
    const config = await loadConfig();
    const { registeredStoreResets } = await import("../src/services/spaces/store-handles.js");
    const { userPromptManager: store, UserPromptManager } = await loadStore();
    expect(registeredStoreResets()).toContain("user-prompts");

    const handle = store as unknown as { dbPath: string };
    await store.countUnanalyzedForUserLearning();
    expect(handle.dbPath).toBe(join(baseDir, "user-prompts.db"));

    config.storagePath = otherDir;
    store.reset();
    expect(handle.dbPath).toBe(join(otherDir, "user-prompts.db"));
    await store.countUnanalyzedForUserLearning();
    expect(handle.dbPath).toBe(join(otherDir, "user-prompts.db"));
    expect(existsSync(join(otherDir, "user-prompts.db"))).toBe(true);
    expect((new UserPromptManager() as unknown as { dbPath: string }).dbPath).toBe(
      join(otherDir, "user-prompts.db")
    );
  });

  // (u) a file from before the four ALTER columns upgrades with its rows kept
  it("upgrades an old-schema file, keeps its rows and releases half-done claims", async () => {
    const legacy = createClient({ url: `file:${join(baseDir, "user-prompts.db")}` });
    await legacy.batch(
      [
        `CREATE TABLE user_prompts (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
          project_path TEXT, content TEXT NOT NULL, created_at INTEGER NOT NULL,
          captured INTEGER DEFAULT 0, user_learning_captured BOOLEAN DEFAULT 0,
          linked_memory_id TEXT
        )`,
        {
          sql: "INSERT INTO user_prompts (id, session_id, message_id, project_path, content, created_at, captured, linked_memory_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          args: ["old-1", "s", "m1", "/old", "kept from the old schema", 100, 2, "mem-old"],
        },
        {
          sql: "INSERT INTO user_prompts (id, session_id, message_id, project_path, content, created_at, captured) VALUES (?, ?, ?, ?, ?, ?, ?)",
          args: ["old-2", "s", "m2", "/old", "already captured", 200, 1],
        },
      ],
      "write"
    );
    legacy.close();

    const { userPromptManager: store } = await loadStore();
    store.reset();
    expect(await store.getPromptById("old-1")).toMatchObject({
      content: "kept from the old schema",
      captured: false,
      linkedMemoryId: "mem-old",
      capture_attempts: 0,
      providerId: null,
      modelId: null,
    });
    expect((await store.getPromptById("old-2"))?.captured).toBe(true);

    const columns = (await raw(baseDir, "PRAGMA table_info(user_prompts)")).map((c) => c.name);
    for (const name of [
      "capture_attempts",
      "provider_id",
      "model_id",
      "user_learning_claimed_at",
    ]) {
      expect(columns).toContain(name);
    }
    // An interrupted claim (captured = 2) is put back in the queue on open.
    expect(
      (await raw(baseDir, "SELECT id, captured FROM user_prompts ORDER BY id")).map((r) => [
        r.id,
        r.captured,
      ])
    ).toEqual([
      ["old-1", 0],
      ["old-2", 1],
    ]);
    // A second open adds nothing and keeps the rows.
    store.reset();
    expect(await store.countUncapturedPrompts(3)).toBe(1);
  });
});

describe("profile catch-up lease (characterisation)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "catch-up-lease-a-"));
    otherDir = mkdtempSync(join(tmpdir(), "catch-up-lease-b-"));
    const config = await loadConfig();
    savedPath = config.storagePath;
    await switchTo(baseDir);
  });

  afterEach(async () => {
    const config = await loadConfig();
    config.storagePath = savedPath;
    await cleanupTursoTestDirectory(baseDir);
    await cleanupTursoTestDirectory(otherDir);
  });

  it("keeps the run record in the active space's user-prompts.db across a switch", async () => {
    const { CatchUpLease, LEASE_EXPIRY_MS } = await loadLease();
    expect(LEASE_EXPIRY_MS).toBe(CLAIM_MS);
    const inA = new CatchUpLease();
    await inA.take("run-a");
    expect(await inA.beginBatch("run-a")).toBe("ok");
    expect(await new CatchUpLease().isActive()).toBe(true);

    await switchTo(otherDir);
    // A lease made in space B does not see space A's record.
    const inB = new CatchUpLease();
    expect(await inB.isActive()).toBe(false);
    await inB.take("run-b");
    expect(await inB.beginBatch("run-b")).toBe("ok");
    expect(await raw(otherDir, "SELECT owner, busy_owner FROM profile_catch_up_lease")).toEqual([
      { owner: "run-b", busy_owner: "run-b" },
    ]);

    await switchTo(baseDir);
    expect(dbFiles(baseDir)).toEqual(["user-prompts.db"]);
    expect(dbFiles(otherDir)).toEqual(["user-prompts.db"]);
    const back = new CatchUpLease();
    expect(await back.isActive()).toBe(true);
    expect(await raw(baseDir, "SELECT owner, busy_owner FROM profile_catch_up_lease")).toEqual([
      { owner: "run-a", busy_owner: "run-a" },
    ]);
    // Space A's run still owns its record and may continue.
    await back.endBatch("run-a");
    expect(await back.beginBatch("run-a")).toBe("ok");
    await back.endBatch("run-a");
    await back.release("run-a");
    expect(await back.isActive()).toBe(false);
  });

  it("treats a record not refreshed for 10 minutes as expired", async () => {
    const { CatchUpLease } = await loadLease();
    let clock = 50_000_000;
    const lease = new CatchUpLease({ now: () => clock, sleep: async (ms) => void (clock += ms) });
    await lease.take("stale");
    expect(await lease.beginBatch("stale")).toBe("ok");
    clock += CLAIM_MS;
    expect(await lease.isActive()).toBe(true);
    clock += 1;
    expect(await lease.isActive()).toBe(false);
    // A newer run takes over a stale mid-batch mark without waiting.
    await lease.take("fresh");
    expect(await lease.beginBatch("fresh")).toBe("ok");
  });
});

describe("waiting prompt read for the import estimate (characterisation)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "user-prompts-estimate-"));
    const config = await loadConfig();
    savedPath = config.storagePath;
    await switchTo(baseDir);
  });

  afterEach(async () => {
    const config = await loadConfig();
    config.storagePath = savedPath;
    await cleanupTursoTestDirectory(baseDir);
  });

  it("returns nothing and creates no table when the store has no prompt table", async () => {
    const { readWaitingProfilePrompts } =
      await import("../src/importer/web-import-profile-estimate.js");
    expect(await readWaitingProfilePrompts()).toEqual(new Set());
    expect(dbFiles(baseDir)).toEqual([]);
    await raw(baseDir, "CREATE TABLE other (x INTEGER)");
    expect(await readWaitingProfilePrompts()).toEqual(new Set());
    expect(
      (await raw(baseDir, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name)
    ).toEqual(["other"]);
  });

  it("reads the waiting prompts of the active space only", async () => {
    const { userPromptManager: store } = await loadStore();
    const { readWaitingProfilePrompts } =
      await import("../src/importer/web-import-profile-estimate.js");
    const learned = await store.savePrompt("s", "learned", "/p", "a prompt already learned");
    await store.markAsUserLearningCaptured(learned);
    await store.savePrompt("s", "waiting", "/p", "a prompt still waiting to learn");
    expect(await readWaitingProfilePrompts()).toEqual(new Set([JSON.stringify(["s", "waiting"])]));
  });
});

describe("store health ping and waiting prompt read (port functions)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "user-prompts-port-"));
    const config = await loadConfig();
    savedPath = config.storagePath;
    await switchTo(baseDir);
  });

  afterEach(async () => {
    const config = await loadConfig();
    config.storagePath = savedPath;
    await cleanupTursoTestDirectory(baseDir);
  });

  it("pings the store at the path given and fails for a folder that cannot hold it", async () => {
    const { pingStore } = await import("../src/services/storage/health.js");
    await pingStore(join(baseDir, "user-prompts.db"));
    expect(dbFiles(baseDir)).toEqual(["user-prompts.db"]);
    // A plain file where the folder should be cannot hold a store.
    writeFileSync(join(baseDir, "blocker"), "not a folder");
    await expect(pingStore(join(baseDir, "blocker", "user-prompts.db"))).rejects.toThrow();
    // The ping runs one query on the connection for that path, and a failed query fails it.
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const queries: string[] = [];
    const open = spyOn(tursoConnectionManager, "getConnection").mockImplementation(
      async () =>
        ({
          all: async (sql: string) => {
            queries.push(sql);
            throw new Error("query failed");
          },
        }) as never
    );
    try {
      await expect(pingStore(join(baseDir, "user-prompts.db"))).rejects.toThrow("query failed");
      expect(open).toHaveBeenCalledWith(join(baseDir, "user-prompts.db"));
      expect(queries).toEqual(["SELECT 1"]);
    } finally {
      open.mockRestore();
    }
  });

  it("reads unanalysed prompts at a path without creating or upgrading anything", async () => {
    const { unanalysedPromptsAt } = await import("../src/services/storage/unanalysed-prompts.js");
    const path = join(baseDir, "user-prompts.db");
    expect(await unanalysedPromptsAt(path)).toEqual([]);
    expect(existsSync(path)).toBe(false);
    await raw(baseDir, "CREATE TABLE other (x INTEGER)");
    expect(await unanalysedPromptsAt(path)).toEqual([]);

    const { userPromptManager: store } = await loadStore();
    const learned = await store.savePrompt("s", "done", "/p", "a prompt already learned");
    await store.markAsUserLearningCaptured(learned);
    await store.savePrompt("s", "wait", "/p", "a prompt still waiting");
    expect(await unanalysedPromptsAt(path)).toEqual([
      { sessionId: "s", messageId: "wait", content: "a prompt still waiting" },
    ]);
  });
});
