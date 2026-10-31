import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const logged: Array<{ message: string; meta: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, meta?: unknown) => logged.push({ message, meta }),
}));

const OLD = "---\nname: s-web-search\ndescription: Search the web\n---\nOld body\n";
const NEW = "---\nname: s-web-search\ndescription: Search the web\n---\nNew body\n";
const NOW = 50_000_000;

let baseDir: string;
let skillsDir: string;
let seq = 0;

interface Call {
  system: string;
  user: string;
  tool: unknown;
}

function stubModel(reply: unknown, ready = true) {
  const calls: Call[] = [];
  const model = {
    ready,
    callTool: async (system: string, user: string, tool: object) => {
      calls.push({ system, user, tool });
      if (reply instanceof Error) throw reply;
      return reply as { success: boolean; data?: unknown };
    },
  };
  return { model, calls };
}

function addSkill(name: string, content = OLD): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

function turn(name: string, path: string | null, at: number, prompt = "search the docs") {
  seq += 1;
  return {
    turnKey: `pi:s1:u${seq}`,
    host: "pi",
    sessionId: "s1",
    projectTag: null,
    projectName: null,
    provider: null,
    model: null,
    createdAt: at,
    prompt,
    replies: ["I searched"],
    redacted: true,
    toolCalls: [{ name: "Bash", input: "curl", outcome: "error" as const, error: "exit 1" }],
    skillUses: [{ name, path, method: "tool" as const }],
  };
}

async function setup(reply: unknown, ready = true) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const drafting = await import("../src/services/skill-learning/drafting.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const { hashSkillContent } = await import("../src/services/skill-learning/apply.js");
  const backoffs = await import("../src/core/profile-backoff.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const { model, calls } = stubModel(reply, ready);
  const deps = () => ({ store, index: buildSkillIndex([skillsDir]), model, now: () => NOW });
  return { store, deps, calls, hashSkillContent, ...drafting, ...proposals, ...backoffs };
}

function ok(data: unknown) {
  return { success: true, data };
}

describe("skill drafting", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-drafting-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
    logged.length = 0;
    const { skillDraftBackoff, profileBackoff } = await import("../src/core/profile-backoff.js");
    skillDraftBackoff.recordSuccess();
    profileBackoff.recordSuccess();
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("saves a valid reply as a pending proposal with a diff, base hash and sent evidence only", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(null);
    await s.store.insertTurn(turn("s-web-search", path, NOW - 1_000));
    const turnId = Number((await (await s.store.db()).get("SELECT id FROM turns"))?.id);
    const { model, calls } = stubModel(
      ok({ content: NEW, summary: "Explain the curl failure", evidence: [`T${turnId}`, "T999"] })
    );
    const result = await s.draftImprovement(path, { ...s.deps(), model });
    expect(result).toMatchObject({ ok: true, code: "proposed" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toContain("Old body");
    expect(calls[0]!.user).toContain(`[T${turnId}]`);
    expect(calls[0]!.user).toContain("Bash: error (exit 1)");
    const [saved] = await s.listProposals(s.store);
    expect(saved).toMatchObject({
      kind: "improve",
      skillName: "s-web-search",
      skillPath: path,
      baseHash: s.hashSkillContent(OLD),
      content: NEW,
      summary: "Explain the curl failure",
      evidenceTurnIds: [turnId],
      state: "pending",
      createdAt: NOW,
    });
    expect(saved!.diff).toContain("-Old body");
    expect(saved!.diff).toContain("+New body");
    expect(saved!.diff).toMatch(/^@@ -2,4 \+2,4 @@\n name: s-web-search\n/);
    expect(readFileSync(path, "utf8")).toBe(OLD);
  });

  it("saves nothing and says No change proposed for an identical file", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(ok({ content: OLD.trimEnd(), summary: "Nothing", evidence: [] }));
    const result = await s.draftImprovement(path, s.deps());
    expect(result).toMatchObject({ ok: true, code: "no-change", message: "No change proposed" });
    expect(await s.listProposals(s.store)).toEqual([]);
  });

  it("reports invalid-reply, saves nothing and pauses automatic drafting", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(ok({ content: 5, summary: "x" }));
    const result = await s.draftImprovement(path, s.deps());
    expect(result).toMatchObject({
      ok: false,
      code: "invalid-reply",
      message: "The model reply was not valid, so nothing was saved. Try again.",
    });
    expect(await s.listProposals(s.store)).toEqual([]);
    expect(logged.map((entry) => entry.meta)).toEqual([{ host: null, reason: "invalid-reply" }]);
    expect(s.skillDraftBackoff.canRun(NOW + 60_000)).toBe(false);
  });

  it("logs timeout with no turn text and pauses skill drafting but not profile learning", async () => {
    const path = addSkill("s-web-search");
    const s = await setup({ success: false, error: "Request timeout after 120000ms" });
    await s.store.insertTurn(turn("s-web-search", path, NOW - 1_000, "secret prompt text"));
    const result = await s.draftImprovement(path, s.deps());
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.meta).toEqual({ host: null, reason: "timeout" });
    expect(JSON.stringify(logged)).not.toContain("secret prompt text");
    expect(s.skillDraftBackoff.canRun(NOW + 60_000)).toBe(false);
    expect(s.skillDraftBackoff.canRun(NOW + 10 * 60_000)).toBe(true);
    expect(s.profileBackoff.canRun(NOW + 60_000)).toBe(true);
  });

  it("maps an HTTP failure to http-<status>", async () => {
    const path = addSkill("s-web-search");
    const s = await setup({ success: false, error: "Bad gateway", httpStatus: 502 });
    expect(await s.draftImprovement(path, s.deps())).toMatchObject({ code: "http-502" });
  });

  it("makes no model call when the external API is not set up", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(ok({ content: NEW, summary: "x", evidence: [] }), false);
    const result = await s.draftImprovement(path, s.deps());
    expect(result).toMatchObject({ ok: false, code: "not-configured" });
    expect(s.calls).toHaveLength(0);
    expect(logged.map((entry) => entry.meta)).toEqual([{ host: null, reason: "not-configured" }]);
  });

  it("sends at most 20 turns, newest first, within the character budgets", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(ok({ content: OLD, summary: "x", evidence: [] }));
    for (let i = 0; i < 25; i++) {
      await s.store.insertTurn(
        turn("s-web-search", path, NOW - (i + 1) * 1_000, `p${i} `.repeat(2_000))
      );
    }
    await s.draftImprovement(path, s.deps());
    const user = s.calls[0]!.user;
    const turnText = user.slice(user.indexOf("Recorded turns"));
    const labels = [...turnText.matchAll(/^\[T(\d+)\]/gm)].map((m) => Number(m[1]));
    expect(labels.length).toBeLessThanOrEqual(s.MAX_DRAFT_TURNS);
    expect(labels.length).toBe(s.MAX_TOTAL_TURN_CHARS / s.MAX_TURN_CHARS);
    expect(labels).toEqual([...labels].sort((a, b) => a - b));
    expect(turnText).toContain("p0 ");
    expect(turnText).not.toContain("p24 ");
    expect(turnText.length).toBeLessThan(s.MAX_TOTAL_TURN_CHARS + 1_000);
    for (const block of turnText.split(/\n\n(?=\[T\d+\])/).slice(1)) {
      expect(block.length).toBeLessThanOrEqual(s.MAX_TURN_CHARS);
    }
  });

  it("limits the sent turns to 20 when they are short", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(ok({ content: OLD, summary: "x", evidence: [] }));
    for (let i = 0; i < 25; i++) {
      await s.store.insertTurn(turn("s-web-search", path, NOW - (i + 1) * 1_000));
    }
    await s.draftImprovement(path, s.deps());
    expect([...s.calls[0]!.user.matchAll(/^\[T\d+\]/gm)]).toHaveLength(20);
  });
});

describe("new skill ideas", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-ideas-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
    logged.length = 0;
    (await import("../src/core/profile-backoff.js")).skillDraftBackoff.recordSuccess();
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  const idea = (name: string, evidence: string[] = []) => ({
    name,
    description: `${name} description`,
    reason: "It repeats",
    evidence,
  });

  it("keeps at most three ideas and drops names that clash with a watched skill", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(null);
    await s.store.insertTurn(turn("s-web-search", path, NOW - 1_000));
    const turnId = Number((await (await s.store.db()).get("SELECT id FROM turns"))?.id);
    const { model, calls } = stubModel(
      ok({
        ideas: [
          idea("s-web-search"),
          idea("S-Web-Search"),
          idea("Not Kebab"),
          idea("release-notes", [`T${turnId}`, "T404"]),
          idea("db-migrate"),
          idea("pr-review"),
          idea("log-triage"),
        ],
      })
    );
    const result = await s.findSkillIdeas({ ...s.deps(), model });
    expect(calls[0]!.user).toContain("s-web-search: Search the web");
    expect(calls[0]!.user).toContain(`[T${turnId}]`);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected ideas");
    expect(result.ideas.map((i) => i.name)).toEqual(["release-notes", "db-migrate", "pr-review"]);
    expect(result.ideas[0]!.evidenceTurnIds).toEqual([turnId]);
    expect(await s.listProposals(s.store)).toEqual([]);
  });

  it("drafts a new skill with name and description front matter as a pending proposal", async () => {
    const s = await setup(
      ok({
        content: "---\nname: release-notes\ndescription: Write release notes\n---\nSteps\n",
        summary: "A release notes skill",
      })
    );
    const result = await s.draftNewSkill(
      { ...idea("release-notes"), evidenceTurnIds: [] },
      skillsDir,
      s.deps()
    );
    expect(result).toMatchObject({ ok: true, code: "proposed" });
    const [saved] = await s.listProposals(s.store);
    expect(saved).toMatchObject({
      kind: "new",
      skillName: "release-notes",
      skillPath: join(skillsDir, "release-notes", "SKILL.md"),
      baseHash: null,
      state: "pending",
    });
    expect(saved!.diff).toContain("+name: release-notes");
    expect(saved!.diff).toMatch(/^@@ -0,0 \+1,5 @@/);
    expect(existsSync(join(skillsDir, "release-notes"))).toBe(false);
  });

  it("refuses a new skill whose front matter is missing or names another skill", async () => {
    for (const content of ["No front matter\n", "---\nname: other\ndescription: x\n---\nBody\n"]) {
      const s = await setup(ok({ content, summary: "x" }));
      const result = await s.draftNewSkill(
        { ...idea("release-notes"), evidenceTurnIds: [] },
        skillsDir,
        s.deps()
      );
      expect(result).toMatchObject({ ok: false, code: "invalid-reply" });
      expect(await s.listProposals(s.store)).toEqual([]);
    }
  });
});
