import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;

async function useStorage(): Promise<void> {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
}

async function openStore() {
  await useStorage();
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  return store;
}

async function raw() {
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  return tursoConnectionManager.getConnection(join(baseDir, "skills.db"));
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
    replies: ["First reply", "Second reply"],
    redacted: true,
    toolCalls: [
      { name: "Read", input: 'file_path: "/a.md"', outcome: "ok" as const, error: null },
      { name: "Bash", input: 'command: "false"', outcome: "error" as const, error: "exit 1" },
    ],
    skillUses: [
      { name: "s-web-search", path: "/skills/s-web-search/SKILL.md", method: "tool" as const },
    ],
  };
}

describe("skill store", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-store-"));
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("creates skills.db with every table and the schema version", async () => {
    await openStore();
    expect(existsSync(join(baseDir, "skills.db"))).toBe(true);
    const db = await raw();
    const tables = (
      await db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    ).map((row) => String(row.name));
    for (const name of [
      "skill_meta",
      "turns",
      "tool_calls",
      "skill_uses",
      "skill_settings",
      "skill_proposals",
      "skill_versions",
    ]) {
      expect(tables).toContain(name);
    }
    const version = await db.get("SELECT value FROM skill_meta WHERE key = 'schema_version'");
    expect(version?.value).toBe("1");
  });

  it("inserts a turn with its tool calls in order and its skill use", async () => {
    const store = await openStore();
    expect(await store.insertTurn(turn())).toBe(true);
    expect(await store.countTurns()).toBe(1);
    const db = await raw();
    const row = await db.get("SELECT * FROM turns");
    expect(row?.prompt).toBe("Search the web");
    expect(JSON.parse(String(row?.replies_json))).toEqual(["First reply", "Second reply"]);
    const calls = await db.all("SELECT name, outcome, error FROM tool_calls ORDER BY position");
    expect(calls.map((c) => [c.name, c.outcome, c.error])).toEqual([
      ["Read", "ok", null],
      ["Bash", "error", "exit 1"],
    ]);
    const uses = await db.all("SELECT skill_name, skill_path, method FROM skill_uses");
    expect(uses).toHaveLength(1);
    expect(uses[0]?.method).toBe("tool");
    expect(uses[0]?.skill_name).toBe("s-web-search");
  });

  it("stores the position of each skill use, and NULL when none is given", async () => {
    const store = await openStore();
    const t = turn();
    t.skillUses = [
      { name: "a", path: "/s/a/SKILL.md", method: "tool" as const, position: 1 },
      { name: "b", path: null, method: "command" as const, position: -1 },
      { name: "c", path: null, method: "read" as const },
    ] as typeof t.skillUses;
    await store.insertTurn(t);
    const db = await raw();
    const rows = await db.all("SELECT skill_name, position FROM skill_uses ORDER BY id");
    expect(rows.map((r) => [r.skill_name, r.position])).toEqual([
      ["a", 1],
      ["b", -1],
      ["c", null],
    ]);
  });

  it("adds the position column to a skills.db made before it existed", async () => {
    await useStorage();
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const db = await raw();
    await db.execute("CREATE TABLE skill_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await db.execute(
      "CREATE TABLE skill_uses (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_id INTEGER NOT NULL, skill_name TEXT NOT NULL, skill_path TEXT, method TEXT NOT NULL)"
    );
    await db.run("INSERT INTO skill_uses (turn_id, skill_name, method) VALUES (1, 'old', 'tool')");
    const store = new SkillStore(skillsDbPath(baseDir));
    await store.init();
    await store.init();
    const columns = (await db.all("PRAGMA table_info(skill_uses)")).map((c) => String(c.name));
    expect(columns).toContain("position");
    expect(
      (await db.get("SELECT position FROM skill_uses WHERE skill_name = 'old'"))?.position
    ).toBeNull();
    expect(
      await store.insertTurn({
        ...turn(),
        skillUses: [{ name: "n", path: null, method: "tool", position: 2 }],
      })
    ).toBe(true);
  });

  it("keeps one copy when the same turn_key is inserted twice", async () => {
    const store = await openStore();
    expect(await store.insertTurn(turn())).toBe(true);
    expect(await store.insertTurn(turn())).toBe(false);
    expect(await store.countTurns()).toBe(1);
    const db = await raw();
    expect(Number((await db.get("SELECT COUNT(*) AS n FROM tool_calls"))?.n)).toBe(2);
    expect(Number((await db.get("SELECT COUNT(*) AS n FROM skill_uses"))?.n)).toBe(1);
  });

  it("looks up a turn_key", async () => {
    const store = await openStore();
    await store.insertTurn(turn());
    expect(await store.hasTurn("pi:s1:u1")).toBe(true);
    expect(await store.hasTurn("pi:s1:u2")).toBe(false);
  });

  it("does not create skills.db for a lookup or a count when the file is missing", async () => {
    await useStorage();
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const store = new SkillStore(skillsDbPath(baseDir));
    expect(await store.hasTurn("pi:s1:u1")).toBe(false);
    expect(await store.countTurns()).toBe(0);
    expect(store.fileSize()).toBe(0);
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });

  it("deletes every turn, tool call and skill use, and keeps proposals", async () => {
    const store = await openStore();
    await store.insertTurn(turn("pi:s1:u1"));
    await store.insertTurn(turn("pi:s1:u2"));
    const db = await raw();
    await db.run(
      `INSERT INTO skill_proposals (id, kind, skill_name, proposed_content, state, created_at, updated_at)
       VALUES ('p1', 'improve', 's-web-search', 'text', 'pending', 1, 1)`
    );
    expect(await store.deleteAllTurns()).toBe(2);
    expect(await store.countTurns()).toBe(0);
    expect(Number((await db.get("SELECT COUNT(*) AS n FROM tool_calls"))?.n)).toBe(0);
    expect(Number((await db.get("SELECT COUNT(*) AS n FROM skill_uses"))?.n)).toBe(0);
    expect(Number((await db.get("SELECT COUNT(*) AS n FROM skill_proposals"))?.n)).toBe(1);
    expect(store.fileSize()).toBeGreaterThan(0);
  });

  it("leaves no deleted turn text in the file bytes", async () => {
    const store = await openStore();
    const marker = "DELETEMARK7f3a9c";
    await store.insertTurn({
      ...turn("pi:s1:u1"),
      prompt: `${marker}-prompt`,
      replies: [`${marker}-reply`],
      toolCalls: [
        { name: "Bash", input: `${marker}-input`, outcome: "error", error: `${marker}-error` },
      ],
    });
    const fileHasMarker = () =>
      readFileSync(join(baseDir, "skills.db")).toString("latin1").includes(marker);
    expect(fileHasMarker()).toBe(true);
    expect(await store.deleteAllTurns()).toBe(1);
    expect(fileHasMarker()).toBe(false);
  });

  it("opens a file from a newer OMMS as read-only", async () => {
    const store = await openStore();
    await store.insertTurn(turn());
    const db = await raw();
    await db.run("UPDATE skill_meta SET value = '99' WHERE key = 'schema_version'");
    const newer = await openStore();
    expect(newer.isReadOnly()).toBe(true);
    expect(await newer.countTurns()).toBe(1);
    await expect(newer.insertTurn(turn("pi:s1:u9"))).rejects.toThrow("read-only");
    await expect(newer.deleteAllTurns()).rejects.toThrow("read-only");
  });
});
