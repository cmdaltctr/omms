import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

/**
 * The agent fixes a skill without the external API: `evidence`, `propose`
 * and `undo` (spec: An agent can fix a skill without the external API).
 */

const OLD = "---\nname: s-web-search\ndescription: Search the web\n---\nOld body\n";
const NEW = "---\nname: s-web-search\ndescription: Search the web\n---\nNew body\n";
const NOW = Date.UTC(2026, 9, 30, 12);

let baseDir: string;
let skillsDir: string;
let seq = 0;

function addSkill(folder: string, content = OLD): string {
  const dir = join(skillsDir, folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

function turn(path: string, failed: boolean, prompt = "search the docs") {
  seq += 1;
  return {
    turnKey: `pi:s1:u${seq}`,
    host: "pi",
    sessionId: "s1",
    projectTag: null,
    projectName: null,
    provider: null,
    model: null,
    createdAt: NOW - 60_000,
    prompt,
    replies: ["I searched"],
    redacted: true,
    toolCalls: [
      {
        name: "Bash",
        input: "curl",
        outcome: failed ? ("error" as const) : ("ok" as const),
        error: failed ? "exit 7" : null,
      },
    ],
    skillUses: [{ name: "s-web-search", path, method: "tool" as const }],
  };
}

async function setup(options: { enabled?: boolean } = {}) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const { clearSkillIndexCache } = await import("../src/services/skill-learning/skill-index.js");
  const ops = await import("../src/core/skill-operations.js");
  clearSkillIndexCache();
  const store = new SkillStore(skillsDbPath(baseDir));
  const calls: string[] = [];
  const deps = {
    enabled: options.enabled ?? true,
    store,
    folders: [skillsDir],
    // The agent path never calls the model.
    model: {
      ready: false,
      callTool: async (_system: string, user: string) => {
        calls.push(user);
        return { success: false, error: "no model" };
      },
    },
    appliedBy: "agent" as const,
    now: () => NOW,
  };
  const run = (mode: string, args: Record<string, unknown> = {}) =>
    ops.runSkillOperation(mode, args, deps);
  return { store, calls, run, ...proposals };
}

/** Inserts the turns and returns their ids in `skills.db`, in insert order. */
async function insertTurns(
  s: Awaited<ReturnType<typeof setup>>,
  turns: ReturnType<typeof turn>[]
): Promise<number[]> {
  await s.store.init();
  for (const t of turns) await s.store.insertTurn(t);
  const db = await s.store.db();
  const rows = await db.all("SELECT id FROM turns ORDER BY id");
  return rows.map((row) => Number(row.id));
}

describe("agent fix modes", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-agent-fix-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("evidence gives the file, its numbers and the turns, a failed one first", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const [failedId, okId] = await insertTurns(s, [turn(path, true), turn(path, false)]);
    const result = await s.run("evidence", { skill: "s-web-search" });
    expect(result).toMatchObject({ success: true, code: "ok" });
    const data = result.data as any;
    expect(data.path).toBe(path);
    expect(data.content).toBe(OLD);
    expect(data).toMatchObject({ uses: 2, failedTurns: 1 });
    expect(data.turns.map((t: any) => t.id)).toEqual([failedId, okId]);
    expect(data.turns[0]).toMatchObject({
      host: "pi",
      prompt: "search the docs",
      replies: ["I searched"],
      failedAfterUse: true,
      tools: [{ name: "Bash", outcome: "error", error: "exit 7" }],
    });
    expect(result.text).toContain("Old body");
    expect(result.text).toContain(`[T${failedId}]`);
    expect(s.calls).toHaveLength(0);
  });

  it("evidence keeps the limit and cuts a turn to 4,000 characters", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    await insertTurns(s, [
      turn(path, false),
      turn(path, false),
      turn(path, false, "x".repeat(5000)),
    ]);
    const result = await s.run("evidence", { skill: "s-web-search", limit: 2 });
    const turns = (result.data as any).turns;
    expect(turns).toHaveLength(2);
    expect(turns[0].prompt).toHaveLength(4000);
    expect(turns[0].cut).toBe(true);
    const tooMany = await s.run("evidence", { skill: "s-web-search", limit: 21 });
    expect(tooMany).toMatchObject({ success: false, code: "invalid-args" });
  });

  it("evidence says recording is off, like list", async () => {
    addSkill("s-web-search");
    const s = await setup({ enabled: false });
    const result = await s.run("evidence", { skill: "s-web-search" });
    expect(result).toMatchObject({ success: false, code: "recording-off" });
    expect(result.text).toContain("Settings → Skill learning");
  });

  it("propose saves a pending improvement with the server's diff and hash", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const [turnId] = await insertTurns(s, [turn(path, true)]);
    const result = await s.run("propose", {
      skill: "s-web-search",
      content: NEW,
      summary: "Explain the curl failure",
      evidence: [turnId, 999],
    });
    expect(result).toMatchObject({ success: true, code: "proposed" });
    const { hashSkillContent } = await import("../src/services/skill-learning/apply.js");
    const saved = await s.getProposal(s.store, (result.data as any).proposal.id);
    expect(saved).toMatchObject({
      kind: "improve",
      skillPath: path,
      state: "pending",
      draftedBy: "agent",
      baseHash: hashSkillContent(OLD),
      summary: "Explain the curl failure",
      evidenceTurnIds: [turnId],
    });
    expect(saved!.diff).toContain("-Old body");
    expect(saved!.diff).toContain("+New body");
    // Nothing is written until the user asks for apply.
    expect(readFileSync(path, "utf8")).toBe(OLD);
    expect(s.calls).toHaveLength(0);
  });

  it("propose with the current content gives no change and counts as a review", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    await insertTurns(s, [turn(path, true)]);
    const result = await s.run("propose", { skill: path, content: OLD, summary: "none" });
    expect(result).toMatchObject({ success: true, code: "no-change" });
    expect(await s.listProposals(s.store)).toEqual([]);
    expect((await s.getSkillSettings(s.store, path))?.lastReviewAt).toBe(NOW);
  });

  it("propose saves a new skill from an idea and a watched folder", async () => {
    const s = await setup();
    const content = "---\nname: deploy\ndescription: Deploy steps\n---\nSteps\n";
    const idea = { name: "deploy", description: "Deploy steps" };
    const result = await s.run("propose", { idea, folder: skillsDir, content, summary: "Deploy" });
    expect(result).toMatchObject({ success: true, code: "proposed" });
    expect((result.data as any).proposal).toMatchObject({
      kind: "new",
      skillPath: join(skillsDir, "deploy", "SKILL.md"),
      baseHash: null,
      draftedBy: "agent",
    });
    const wrongName = await s.run("propose", {
      idea,
      folder: skillsDir,
      content: content.replace("name: deploy", "name: other"),
      summary: "x",
    });
    expect(wrongName).toMatchObject({ success: false, code: "invalid-content" });
    const badName = await s.run("propose", {
      idea: { name: "Deploy Now", description: "x" },
      folder: skillsDir,
      content,
      summary: "x",
    });
    expect(badName).toMatchObject({ success: false, code: "invalid-name" });
    const notWatched = await s.run("propose", { idea, folder: baseDir, content, summary: "x" });
    expect(notWatched).toMatchObject({ success: false, code: "not-watched" });
  });

  it("propose refuses content over 100 KB", async () => {
    addSkill("s-web-search");
    const s = await setup();
    const big = `${OLD}${"x".repeat(100 * 1024)}`;
    const result = await s.run("propose", { skill: "s-web-search", content: big, summary: "x" });
    expect(result).toMatchObject({ success: false, code: "too-large" });
    expect(await s.listProposals(s.store)).toEqual([]);
  });

  it("apply still waits for its own call, and undo restores the file", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposed = await s.run("propose", { skill: "s-web-search", content: NEW, summary: "x" });
    const id = (proposed.data as any).proposal.id;
    expect(readFileSync(path, "utf8")).toBe(OLD);
    expect(await s.run("apply", { id })).toMatchObject({ success: true, code: "applied" });
    expect(readFileSync(path, "utf8")).toBe(NEW);
    expect(await s.run("undo", { id })).toMatchObject({ success: true, code: "undone" });
    expect(readFileSync(path, "utf8")).toBe(OLD);
    expect((await s.getProposal(s.store, id))?.state).toBe("undone");
    expect(await s.run("undo", { id })).toMatchObject({ success: false, code: "not-applied" });
    expect(await s.run("undo", {})).toMatchObject({ success: false, code: "invalid-args" });
  });
});
