import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

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

function turn(name: string, path: string | null, failed: boolean) {
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
    prompt: "search the docs",
    replies: ["I searched"],
    redacted: true,
    toolCalls: [
      { name: "Bash", input: "curl", outcome: failed ? "error" : "ok", error: null } as const,
    ],
    skillUses: [{ name, path, method: "tool" as const }],
  };
}

function stubModel(reply: unknown) {
  const calls: string[] = [];
  return {
    calls,
    model: {
      ready: true,
      callTool: async (_system: string, user: string) => {
        calls.push(user);
        return { success: true, data: reply };
      },
    },
  };
}

async function setup(options: { enabled?: boolean; reply?: unknown } = {}) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const { clearSkillIndexCache } = await import("../src/services/skill-learning/skill-index.js");
  const { skillDraftBackoff } = await import("../src/core/profile-backoff.js");
  const ops = await import("../src/core/skill-operations.js");
  clearSkillIndexCache();
  skillDraftBackoff.recordSuccess();
  const dbPath = skillsDbPath(baseDir);
  const store = new SkillStore(dbPath);
  const { model, calls } = stubModel(options.reply ?? null);
  const deps = {
    enabled: options.enabled ?? true,
    store,
    folders: [skillsDir],
    model,
    appliedBy: "agent" as const,
    now: () => NOW,
  };
  const run = (mode: string, args: Record<string, unknown> = {}) =>
    ops.runSkillOperation(mode, args, deps);
  return { store, dbPath, calls, run, ...proposals };
}

async function seedProposal(s: Awaited<ReturnType<typeof setup>>, path: string) {
  const { hashSkillContent } = await import("../src/services/skill-learning/apply.js");
  await s.store.init();
  return s.createProposal(
    s.store,
    {
      kind: "improve",
      skillName: "s-web-search",
      skillPath: path,
      baseHash: hashSkillContent(OLD),
      content: NEW,
      diff: "-Old body\n+New body",
      summary: "Explain the curl failure",
      evidenceTurnIds: [7, 9],
    },
    NOW - 1_000
  );
}

describe("skill operations", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-operations-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("gives the host tools the same modes as the operations", async () => {
    const { SKILL_OPERATION_MODES } = await import("../src/core/skill-operations.js");
    const { SKILLS_TOOL_MODES } = await import("../src/core/skills-tool.js");
    expect([...SKILLS_TOOL_MODES]).toEqual([...SKILL_OPERATION_MODES]);
  });

  it("help lists every mode", async () => {
    const s = await setup();
    const result = await s.run("help");
    expect(result.success).toBe(true);
    for (const mode of [
      "list",
      "ideas",
      "draft",
      "evidence",
      "propose",
      "proposals",
      "show",
      "apply",
      "reject",
      "undo",
    ]) {
      expect(result.text).toContain(mode);
    }
  });

  it("list shows ranked skills with Suggested and Not in a watched folder", async () => {
    const path = addSkill("s-web-search");
    addSkill("unused", "---\nname: unused\n---\nBody\n");
    const s = await setup();
    await s.store.init();
    for (let i = 0; i < 5; i++) await s.store.insertTurn(turn("s-web-search", path, i < 2));
    await s.store.insertTurn(turn("elsewhere", null, false));
    const result = await s.run("list");
    expect(result).toMatchObject({ success: true, code: "ok" });
    const skills = (result.data as { skills: Array<Record<string, unknown>> }).skills;
    expect(skills[0]).toMatchObject({ name: "s-web-search", uses: 5, failedTurns: 2 });
    expect(result.text).toContain("s-web-search: 5 uses, 2 failed turns, last used 2026-10-30");
    expect(result.text).toContain("Suggested");
    expect(result.text).toContain("elsewhere: 1 use, 0 failed turns");
    expect(result.text).toContain("Not in a watched folder");
    expect(result.text).toContain("unused: 0 uses");
  });

  it("list orders by attention with order attention, and rejects an unknown order", async () => {
    const busy = addSkill("busy-skill");
    const rough = addSkill("rough-skill");
    const s = await setup();
    await s.store.init();
    for (let i = 0; i < 8; i++) await s.store.insertTurn(turn("busy-skill", busy, false));
    for (let i = 0; i < 3; i++) await s.store.insertTurn(turn("rough-skill", rough, i < 2));
    const names = (r: { data?: unknown }) =>
      (r.data as { skills: Array<{ name: string }> }).skills.map((x) => x.name);
    expect(names(await s.run("list"))).toEqual(["busy-skill", "rough-skill"]);
    const byAttention = await s.run("list", { order: "attention" });
    expect(names(byAttention)).toEqual(["rough-skill", "busy-skill"]);
    expect(byAttention.text).toContain("Skills by attention");
    expect(byAttention.text).toContain("attention 0.60");
    const bad = await s.run("list", { order: "newest" });
    expect(bad).toMatchObject({ success: false, code: "invalid-args" });
  });

  it("ideas returns the model's ideas", async () => {
    addSkill("s-web-search");
    const s = await setup({
      reply: {
        ideas: [
          { name: "release-notes", description: "Write notes", reason: "Seen often", evidence: [] },
        ],
      },
    });
    await s.store.init();
    await s.store.insertTurn(turn("s-web-search", null, false));
    const result = await s.run("ideas");
    expect(result).toMatchObject({ success: true, code: "ok" });
    expect(result.text).toContain("release-notes: Write notes");
    expect((result.data as { ideas: unknown[] }).ideas).toHaveLength(1);
  });

  it("draft resolves a skill name and saves a pending proposal", async () => {
    addSkill("s-web-search");
    const s = await setup({ reply: { content: NEW, summary: "Explain curl", evidence: [] } });
    const result = await s.run("draft", { skill: "s-web-search" });
    expect(result).toMatchObject({ success: true, code: "proposed" });
    const [saved] = await s.listProposals(s.store);
    expect(saved).toMatchObject({ kind: "improve", state: "pending" });
    expect(result.text).toContain(saved!.id);
  });

  it("draft asks for the path when two skills share a name", async () => {
    const a = addSkill("web/s-web-search");
    const b = addSkill("tools/s-web-search");
    const s = await setup({ reply: { content: NEW, summary: "x", evidence: [] } });
    const result = await s.run("draft", { skill: "s-web-search" });
    expect(result).toMatchObject({ success: false, code: "ambiguous" });
    expect(result.text).toContain(a);
    expect(result.text).toContain(b);
    expect(s.calls).toHaveLength(0);
    const byPath = await s.run("draft", { skill: b });
    expect(byPath).toMatchObject({ success: true, code: "proposed" });
  });

  it("draft writes a new skill proposal from an idea and a watched folder", async () => {
    const content = "---\nname: release-notes\ndescription: Write notes\n---\nSteps\n";
    const s = await setup({ reply: { content, summary: "Writes release notes" } });
    const idea = { name: "release-notes", description: "Write notes", reason: "Seen often" };
    const outside = await s.run("draft", { idea, folder: join(baseDir, "elsewhere") });
    expect(outside).toMatchObject({ success: false, code: "not-watched" });
    const result = await s.run("draft", { idea, folder: skillsDir });
    expect(result).toMatchObject({ success: true, code: "proposed" });
    const [saved] = await s.listProposals(s.store);
    expect(saved).toMatchObject({
      kind: "new",
      skillPath: join(skillsDir, "release-notes", "SKILL.md"),
    });
  });

  it("proposals lists proposals and filters by state", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await seedProposal(s, path);
    const all = await s.run("proposals");
    expect(all.text).toContain(proposal.id);
    expect(all.text).toContain("pending");
    const applied = await s.run("proposals", { state: "applied" });
    expect((applied.data as { proposals: unknown[] }).proposals).toHaveLength(0);
    const bad = await s.run("proposals", { state: "done" });
    expect(bad).toMatchObject({ success: false, code: "invalid-args" });
  });

  it("show gives the diff, summary and evidence", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await seedProposal(s, path);
    const result = await s.run("show", { id: proposal.id });
    expect(result.success).toBe(true);
    expect(result.text).toContain("Explain the curl failure");
    expect(result.text).toContain("+New body");
    expect(result.text).toContain("T7, T9");
    const missing = await s.run("show", { id: "nope" });
    expect(missing).toMatchObject({ success: false, code: "not-found" });
  });

  it("apply writes the file and records that an agent applied it", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await seedProposal(s, path);
    const result = await s.run("apply", { id: proposal.id });
    expect(result).toMatchObject({ success: true, code: "applied" });
    expect(readFileSync(path, "utf8")).toBe(NEW);
    expect(await s.getProposal(s.store, proposal.id)).toMatchObject({
      state: "applied",
      appliedBy: "agent",
    });
  });

  it("reject marks only a pending proposal rejected", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await seedProposal(s, path);
    const result = await s.run("reject", { id: proposal.id });
    expect(result).toMatchObject({ success: true, code: "rejected" });
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("rejected");
    const again = await s.run("reject", { id: proposal.id });
    expect(again).toMatchObject({ success: false, code: "not-pending" });
    expect(readFileSync(path, "utf8")).toBe(OLD);
  });

  it("says recording is off for list, ideas and draft, and still shows proposals", async () => {
    const path = addSkill("s-web-search");
    const off = await setup({ enabled: false });
    for (const mode of ["list", "ideas", "draft"]) {
      const result = await off.run(mode, { skill: "s-web-search" });
      expect(result).toMatchObject({ success: false, code: "recording-off" });
      expect(result.text).toContain("Settings → Skill learning");
      expect(result.text).toContain("skillLearning: true");
    }
    expect(off.calls).toHaveLength(0);
    expect(existsSync(off.dbPath)).toBe(false);
    const proposal = await seedProposal(off, path);
    const shown = await off.run("proposals");
    expect(shown.text).toContain(proposal.id);
  });

  it("rejects an unknown mode", async () => {
    const s = await setup();
    const result = await s.run("dance");
    expect(result).toMatchObject({ success: false, code: "invalid-args" });
  });
});
