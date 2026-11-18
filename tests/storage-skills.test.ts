import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the skills store (storage port slice S8). It pins what `skills.db` does
// today so the move into src/services/storage/skills/ cannot change it: reads, writes, the
// old-schema upgrade, the newer-schema check and the global folder across a space switch.
// Every store here is real, in a temp folder or in the isolated test home.

let baseDir: string;
let skillsDir: string;
let savedPath: string;

async function load() {
  const store = await import("../src/services/storage/skills/store.js");
  const proposals = await import("../src/services/storage/skills/proposals.js");
  const summaries = await import("../src/services/skill-learning/proposal-summaries.js");
  return { ...store, ...proposals, ...summaries };
}

/** Reads a table through a second, raw libSQL client, so the test does not trust the store. */
async function rawRows(sql: string): Promise<Record<string, unknown>[]> {
  const client = createClient({ url: `file:${join(baseDir, "skills.db")}` });
  try {
    return (await client.execute(sql)).rows as unknown as Record<string, unknown>[];
  } finally {
    client.close();
  }
}

async function closeSkillsDb(): Promise<void> {
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  await tursoConnectionManager.closeConnection(join(baseDir, "skills.db"));
}

function turn(turnKey = "pi:s1:u1") {
  return {
    turnKey,
    host: "pi",
    sessionId: "s1",
    projectTag: "p_a",
    projectName: "omms",
    provider: "anthropic",
    model: "claude",
    createdAt: 1_000,
    prompt: "Search the web",
    replies: ["First reply"],
    redacted: true,
    toolCalls: [{ name: "Read", input: "a", outcome: "ok" as const, error: null }],
    skillUses: [{ name: "alpha", path: "/skills/alpha/SKILL.md", method: "tool" as const }],
  };
}

function proposal(skillPath: string | null, content = "new body\n") {
  return {
    kind: "improve" as const,
    skillName: "alpha",
    skillPath,
    baseHash: null,
    content,
    diff: "-old\n+new\n+more",
    summary: "Tighten",
    evidenceTurnIds: [3, 4],
  };
}

describe("skills store (characterisation)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "skills-store-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
    const { CONFIG } = await import("../src/config.js");
    savedPath = CONFIG.storagePath;
    CONFIG.storagePath = baseDir;
  });

  afterEach(async () => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = savedPath;
    await cleanupTursoTestDirectory(baseDir);
  });

  // The old paths stay as re-exports, so the many callers and tests that import them get the same store.
  it("keeps the old module paths as re-exports of the same store", async () => {
    const m = await load();
    const oldStore = await import("../src/services/skill-learning/store.js");
    const oldProposals = await import("../src/services/skill-learning/proposal-store.js");
    expect(oldStore.SkillStore).toBe(m.SkillStore);
    expect(oldStore.skillsDbPath).toBe(m.skillsDbPath);
    expect(oldProposals.createProposal).toBe(m.createProposal);
    expect(oldProposals.getSkillSettings).toBe(m.getSkillSettings);
  });

  // (r) read through the public API
  it("reads turns, proposals, versions and settings back through the public API", async () => {
    const m = await load();
    const store = new m.SkillStore(m.skillsDbPath(baseDir));
    expect(await store.countTurns()).toBe(0);
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
    await store.init();

    expect(await store.insertTurn(turn())).toBe(true);
    expect(await store.insertTurn(turn())).toBe(false);
    expect(await store.hasTurn("pi:s1:u1")).toBe(true);
    expect(await store.hasTurn("pi:s1:u2")).toBe(false);
    expect(await store.countTurns()).toBe(1);

    const first = await m.createProposal(store, proposal("/skills/alpha/SKILL.md"), 2_000);
    const second = await m.createProposal(store, proposal(null, "a\nb\n"), 3_000);
    expect(await m.getProposal(store, first.id)).toEqual(first);
    expect(first).toMatchObject({ state: "pending", draftedBy: "model", appliedBy: null });

    const rows = await m.listProposalRows(store);
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(rows[1]).toEqual({
      id: first.id,
      kind: "improve",
      skillName: "alpha",
      skillPath: "/skills/alpha/SKILL.md",
      state: "pending",
      appliedBy: null,
      draftedBy: "model",
      summary: "Tighten",
      evidenceTurnIds: [3, 4],
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    expect(
      (await m.listProposalRows(store, { skillPath: "/skills/alpha/SKILL.md" })).map((r) => r.id)
    ).toEqual([first.id]);
    const counts = await m.proposalLineCounts(store, [first.id, second.id, "missing"]);
    expect(counts.get(first.id)).toEqual({ added: 2, removed: 1, hasDiff: true });
    expect(counts.has("missing")).toBe(false);

    expect(await m.updateProposalState(store, first.id, "applied", 4_000, "person")).toBe(true);
    expect(await m.updateProposalState(store, "missing", "applied", 4_000)).toBe(false);
    const versionId = await m.saveSkillVersion(
      store,
      {
        proposalId: first.id,
        path: "/skills/alpha/SKILL.md",
        previousContent: "old\n",
        writtenHash: "h1",
      },
      4_000
    );
    expect(await m.getLatestVersion(store, first.id)).toEqual({
      id: versionId,
      proposalId: first.id,
      path: "/skills/alpha/SKILL.md",
      previousContent: "old\n",
      writtenHash: "h1",
      savedAt: 4_000,
    });

    const path = "/skills/alpha/SKILL.md";
    expect(await m.getSkillSettings(store, path)).toEqual({
      skillPath: path,
      mode: "manual",
      lastReviewAt: null,
      usesAtLastReview: 0,
    });
    await m.setSkillMode(store, path, "automatic");
    await m.setSkillReview(store, path, 5_000, 12);
    expect(await m.getSkillSettings(store, path)).toEqual({
      skillPath: path,
      mode: "automatic",
      lastReviewAt: 5_000,
      usesAtLastReview: 12,
    });
  });

  // (r) the history and undo checks read the newest saved version of each applied proposal
  it("reads the newest saved version for the history and the undo check", async () => {
    const m = await load();
    const apply = await import("../src/services/skill-learning/apply.js");
    const history = await import("../src/services/skill-learning/history.js");
    const store = new m.SkillStore(m.skillsDbPath(baseDir));
    await store.init();
    mkdirSync(join(skillsDir, "alpha"));
    const path = join(skillsDir, "alpha", "SKILL.md");
    const base = "---\nname: alpha\n---\nBody 0\n";
    writeFileSync(path, base);
    let clock = 10_000;
    const deps = { store, folders: [skillsDir], now: () => (clock += 100) };
    const p = await m.createProposal(
      store,
      {
        ...proposal(path, "---\nname: alpha\n---\nBody 1\n"),
        baseHash: apply.hashSkillContent(base),
      },
      (clock += 100)
    );
    expect((await apply.applyProposal(p.id, "person", deps)).code).toBe("applied");
    const version = await m.getLatestVersion(store, p.id);

    const page = await history.skillHistory(deps, { path }, 10, 0);
    expect(page.total).toBe(2);
    expect(page.entries[0]).toMatchObject({
      kind: "applied",
      versionId: String(version!.id),
      canUndo: true,
      laterAppliedCount: 0,
    });
    const withUndo = await history.withCanUndo(deps, [{ id: p.id, state: "applied" }]);
    expect(withUndo[0]?.canUndo).toBe(true);
    writeFileSync(path, "edited by hand\n");
    expect((await history.withCanUndo(deps, [{ id: p.id, state: "applied" }]))[0]?.canUndo).toBe(
      false
    );
  });

  // (w) write through the API, read back with a raw client
  it("writes the documented columns to skills.db", async () => {
    const m = await load();
    const store = new m.SkillStore(m.skillsDbPath(baseDir));
    await store.init();
    await store.insertTurn({
      ...turn(),
      skillUses: [{ name: "alpha", path: null, method: "read" as const, position: 0 }],
    });
    const p = await m.createProposal(store, { ...proposal(null), draftedBy: "agent" }, 2_000);
    await m.setSkillMode(store, "/s/SKILL.md", "automatic");
    await closeSkillsDb();

    expect(await rawRows("SELECT key, value FROM skill_meta")).toEqual([
      { key: "schema_version", value: "1" },
    ]);
    const turns = await rawRows("SELECT * FROM turns");
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turn_key: "pi:s1:u1",
      host: "pi",
      session_id: "s1",
      project_tag: "p_a",
      project_name: "omms",
      provider: "anthropic",
      model: "claude",
      created_at: 1_000,
      prompt: "Search the web",
      replies_json: '["First reply"]',
      redacted: 1,
    });
    expect(await rawRows("SELECT position, name, input, outcome, error FROM tool_calls")).toEqual([
      { position: 0, name: "Read", input: "a", outcome: "ok", error: null },
    ]);
    expect(
      await rawRows("SELECT skill_name, skill_path, method, position FROM skill_uses")
    ).toEqual([{ skill_name: "alpha", skill_path: null, method: "read", position: 0 }]);
    const proposals = await rawRows("SELECT * FROM skill_proposals");
    expect(proposals[0]).toMatchObject({
      id: p.id,
      kind: "improve",
      skill_name: "alpha",
      skill_path: null,
      proposed_content: "new body\n",
      evidence_turn_ids: "[3,4]",
      state: "pending",
      applied_by: null,
      drafted_by: "agent",
      created_at: 2_000,
      updated_at: 2_000,
    });
    expect(await rawRows("SELECT skill_path, mode FROM skill_settings")).toEqual([
      { skill_path: "/s/SKILL.md", mode: "automatic" },
    ]);
  });

  // (u) the store ALTERs its schema: an old file upgrades in place and keeps its rows
  it("upgrades an old-schema skills.db and keeps its rows", async () => {
    const client = createClient({ url: `file:${join(baseDir, "skills.db")}` });
    await client.batch([
      "CREATE TABLE skill_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      `CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_key TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL, session_id TEXT NOT NULL, project_tag TEXT, project_name TEXT,
        provider TEXT, model TEXT, created_at INTEGER NOT NULL, prompt TEXT NOT NULL,
        replies_json TEXT NOT NULL, redacted INTEGER NOT NULL)`,
      `CREATE TABLE skill_uses (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_id INTEGER NOT NULL,
        skill_name TEXT NOT NULL, skill_path TEXT, method TEXT NOT NULL)`,
      `CREATE TABLE skill_proposals (id TEXT PRIMARY KEY, kind TEXT NOT NULL,
        skill_name TEXT NOT NULL, skill_path TEXT, base_hash TEXT, proposed_content TEXT NOT NULL,
        diff TEXT, summary TEXT, evidence_turn_ids TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL,
        applied_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `INSERT INTO turns (turn_key, host, session_id, created_at, prompt, replies_json, redacted)
        VALUES ('pi:old:1', 'pi', 'old', 1, 'old prompt', '[]', 0)`,
      "INSERT INTO skill_uses (turn_id, skill_name, method) VALUES (1, 'old', 'tool')",
      `INSERT INTO skill_proposals (id, kind, skill_name, proposed_content, state, created_at, updated_at)
        VALUES ('old-p', 'new', 'old', 'body', 'pending', 1, 1)`,
    ]);
    client.close();

    const m = await load();
    const store = new m.SkillStore(m.skillsDbPath(baseDir));
    await store.init();
    expect(store.isReadOnly()).toBe(false);
    expect(await store.hasTurn("pi:old:1")).toBe(true);
    expect(await store.countTurns()).toBe(1);
    expect(await m.getProposal(store, "old-p")).toMatchObject({
      draftedBy: "model",
      content: "body",
    });
    expect(await store.insertTurn(turn())).toBe(true);
    await closeSkillsDb();

    const columns = async (table: string) =>
      (await rawRows(`PRAGMA table_info(${table})`)).map((c) => String(c.name));
    expect(await columns("skill_uses")).toContain("position");
    expect(await columns("skill_proposals")).toContain("drafted_by");
    expect(await rawRows("SELECT value FROM skill_meta WHERE key = 'schema_version'")).toEqual([
      { value: "1" },
    ]);
    expect(await rawRows("SELECT skill_name, position FROM skill_uses ORDER BY id")).toEqual([
      { skill_name: "old", position: null },
      { skill_name: "alpha", position: null },
    ]);
  });

  // (u) a file from a newer OMMS stays read-only, and the chat skill reader refuses it
  it("leaves a newer-schema skills.db unchanged and the chat reader reports newer_schema", async () => {
    const m = await load();
    const store = new m.SkillStore(m.skillsDbPath(baseDir));
    await store.init();
    await store.insertTurn(turn());
    const { chatSkillsDep } = await import("../src/services/chat/chat-skills-runtime.js");
    const config = { storagePath: baseDir, skillLearning: true, skillFolders: [skillsDir] };
    // The current version is accepted.
    expect(await (await chatSkillsDep(config))!.rank()).toEqual([]);

    const db = await store.db();
    await db.run("UPDATE skill_meta SET value = ? WHERE key = 'schema_version'", [
      String(m.SKILL_SCHEMA_VERSION + 1),
    ]);
    await closeSkillsDb();
    const hash = () =>
      createHash("sha256")
        .update(readFileSync(join(baseDir, "skills.db")))
        .digest("hex");
    const before = hash();

    const newer = new m.SkillStore(m.skillsDbPath(baseDir));
    await newer.init();
    expect(newer.isReadOnly()).toBe(true);
    await expect(newer.insertTurn(turn("pi:s1:u9"))).rejects.toThrow("read-only");
    await expect(m.setSkillMode(newer, "/x", "automatic")).rejects.toThrow("read-only");
    expect(await newer.countTurns()).toBe(1);
    await expect((await chatSkillsDep(config))!.rank()).rejects.toMatchObject({
      code: "newer_schema",
    });
    await closeSkillsDb();
    expect(hash()).toBe(before);
  });
});

describe("skills.db across a memory space switch", () => {
  const globalConfigFile = join(homedir(), ".config", "omms", "omms.jsonc");
  let project: string;

  afterAll(async () => {
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    const files = spaceFiles(join(homedir(), ".omms"));
    await cleanupTursoTestDirectory(files.spacesRoot);
    await cleanupTursoTestDirectory(project);
    rmSync(files.registryPath, { force: true });
    rmSync(globalConfigFile, { force: true });
  });

  it("stays in the global folder while the active space changes", async () => {
    project = mkdtempSync(join(tmpdir(), "skills-switch-"));
    mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
    writeFileSync(globalConfigFile, JSON.stringify({ skillLearning: true, skillFolders: [] }));
    const configModule = await import("../src/config.js");
    const { createStoredSpace, spaceFiles, switchStoredSpace } =
      await import("../src/services/spaces/registry-store.js");
    const { skillTurnRecorder, skillTurnSettingsFor } =
      await import("../src/services/skill-learning/settings-for.js");
    const { getSkillStoragePath } = await import("../src/services/storage/active-space-access.js");
    const m = await load();
    const omms = join(homedir(), ".omms");
    const files = spaceFiles(omms);
    const globalFolder = join(omms, "data");
    configModule.initConfig(project);
    expect(configModule.CONFIG.storagePath).toBe(globalFolder);

    const unit = (promptId: string) =>
      ({
        host: "pi",
        hostSessionId: "s1",
        sourceType: "live",
        projectDirectory: project,
        userPrompt: `prompt ${promptId}`,
        promptId,
        textResponses: ["done"],
        toolCalls: [],
      }) as never;
    expect(await skillTurnRecorder(project, configModule)!(unit("u1"))).toBe("new");

    const space = await createStoredSpace(files, "Skills switch");
    await switchStoredSpace(files, space.id);
    configModule.refreshConfigIfChanged(project);
    const spaceFolder = join(files.spacesRoot, space.id);
    expect(configModule.CONFIG.storagePath).toBe(spaceFolder);
    // Memories follow the space; skills.db does not.
    expect(skillTurnSettingsFor(project, configModule).storagePath).toBe(globalFolder);
    expect(getSkillStoragePath()).toBe(globalFolder);
    expect(await skillTurnRecorder(project, configModule)!(unit("u2"))).toBe("new");
    expect(existsSync(join(spaceFolder, "skills.db"))).toBe(false);
    const inSpace = new m.SkillStore(
      m.skillsDbPath(skillTurnSettingsFor(project, configModule).storagePath)
    );
    expect(await inSpace.countTurns()).toBe(2);

    await switchStoredSpace(files, "default");
    configModule.refreshConfigIfChanged(project);
    expect(configModule.CONFIG.storagePath).toBe(globalFolder);
    const back = new m.SkillStore(
      m.skillsDbPath(skillTurnSettingsFor(project, configModule).storagePath)
    );
    expect(await back.countTurns()).toBe(2);
    expect(existsSync(join(spaceFolder, "skills.db"))).toBe(false);
  });
});
