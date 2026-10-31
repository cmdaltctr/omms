import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;
let skillsDir: string;

async function runtimeConfig(over: Record<string, unknown> = {}) {
  return {
    storagePath: baseDir,
    memoryProvider: "openai-chat",
    skillLearning: true,
    skillFolders: [skillsDir],
    ...over,
  };
}

describe("chat skill facts runtime", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "chat-skills-runtime-"));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    skillsDir = join(baseDir, "skills");
    mkdirSync(join(skillsDir, "alpha"), { recursive: true });
    writeFileSync(join(skillsDir, "alpha", "SKILL.md"), "---\nname: alpha\n---\nBody\n");
  });
  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("builds no skill reader while skillLearning is off", async () => {
    const { chatServiceDeps } = await import("../src/services/chat/chat-runtime.js");
    const deps = await chatServiceDeps(await runtimeConfig({ skillLearning: false }));
    expect(deps.skills).toBeUndefined();
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });

  it("builds no skill reader when skillLearning is unset", async () => {
    const { chatServiceDeps } = await import("../src/services/chat/chat-runtime.js");
    const deps = await chatServiceDeps(await runtimeConfig({ skillLearning: undefined }));
    expect(deps.skills).toBeUndefined();
  });

  it("ranks watched skills with zero counts and creates no skills.db when none exists", async () => {
    const { chatServiceDeps } = await import("../src/services/chat/chat-runtime.js");
    const deps = await chatServiceDeps(await runtimeConfig());
    const rows = await deps.skills!.rank();
    expect(rows.map((row) => [row.name, row.uses])).toEqual([["alpha", 0]]);
    expect(await deps.skills!.history(rows[0]!)).toEqual([]);
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });

  it("fails with newer_schema for a newer skills.db and leaves its bytes alone", async () => {
    const { SkillStore, skillsDbPath, SKILL_SCHEMA_VERSION } =
      await import("../src/services/skill-learning/store.js");
    const path = skillsDbPath(baseDir);
    const store = new SkillStore(path);
    await store.init();
    const db = await store.db();
    await db.run("UPDATE skill_meta SET value = ? WHERE key = 'schema_version'", [
      String(SKILL_SCHEMA_VERSION + 1),
    ]);
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    await tursoConnectionManager.closeConnection?.(path);
    const before = readFileSync(path);

    const { chatServiceDeps } = await import("../src/services/chat/chat-runtime.js");
    const deps = await chatServiceDeps(await runtimeConfig());
    await expect(deps.skills!.rank()).rejects.toMatchObject({ code: "newer_schema" });
    await tursoConnectionManager.closeConnection?.(path);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("leaves skills.db byte for byte unchanged after reading ranking and history", async () => {
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const { createProposal } = await import("../src/services/skill-learning/proposal-store.js");
    const path = skillsDbPath(baseDir);
    const store = new SkillStore(path);
    await store.init();
    await createProposal(
      store,
      {
        kind: "edit",
        skillName: "alpha",
        skillPath: join(skillsDir, "alpha", "SKILL.md"),
        baseHash: "h",
        content: "x",
        diff: "+x",
        summary: "Add a step",
        evidenceTurnIds: [],
      } as never,
      Date.now()
    );
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    await tursoConnectionManager.closeConnection(path);
    const before = readFileSync(path);

    const { chatServiceDeps } = await import("../src/services/chat/chat-runtime.js");
    const deps = await chatServiceDeps(await runtimeConfig());
    const rows = await deps.skills!.rank();
    const history = await deps.skills!.history(rows[0]!);
    expect(history.length).toBeGreaterThan(0);
    await tursoConnectionManager.closeConnection(path);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("lists the names of ranked skills for the missing-skill check", async () => {
    const { listedSkillNames } = await import("../src/services/chat/chat-runtime.js");
    expect([...(await listedSkillNames(await runtimeConfig()))!]).toEqual(["alpha"]);
  });
});
