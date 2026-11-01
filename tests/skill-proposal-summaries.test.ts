import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { allProposals } from "./skill-proposal-helpers.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;

async function setup(init = true) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const summaries = await import("../src/services/skill-learning/proposal-summaries.js");
  const { lineDiff } = await import("../src/services/skill-learning/line-diff.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  if (init) await store.init();
  return { store, lineDiff, ...proposals, ...summaries };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const BEFORE = "a\nb\nc\n";
const AFTER = "a\nB\nc\nd\ne\n";

function improvement(s: Setup, name: string, at: number, extra: Record<string, unknown> = {}) {
  return s.createProposal(
    s.store,
    {
      kind: "improve",
      skillName: name,
      skillPath: `/skills/${name}/SKILL.md`,
      baseHash: "hash",
      content: AFTER,
      diff: s.lineDiff(BEFORE, AFTER),
      summary: `Change ${name}`,
      evidenceTurnIds: [3, 7],
      ...extra,
    },
    at
  );
}

function newSkill(s: Setup, name: string, at: number, content: string) {
  return s.createProposal(
    s.store,
    {
      kind: "new",
      skillName: name,
      skillPath: `/skills/${name}/SKILL.md`,
      baseHash: null,
      content,
      diff: null,
      summary: `New ${name}`,
      evidenceTurnIds: [],
      draftedBy: "agent",
    },
    at
  );
}

describe("skill proposal summaries", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-summaries-"));
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("returns every summary field and neither content nor diff", async () => {
    const s = await setup();
    const created = await improvement(s, "alpha", 1_000);
    const { proposals, total } = await s.listProposalSummaries(s.store, {});
    expect(total).toBe(1);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual({
      id: created.id,
      kind: "improve",
      skillName: "alpha",
      skillPath: "/skills/alpha/SKILL.md",
      state: "pending",
      appliedBy: null,
      draftedBy: "model",
      summary: "Change alpha",
      evidenceTurnIds: [3, 7],
      createdAt: 1_000,
      updatedAt: 1_000,
      added: 3,
      removed: 1,
      hasDiff: true,
    });
    expect("content" in proposals[0]!).toBe(false);
    expect("diff" in proposals[0]!).toBe(false);
    expect("baseHash" in proposals[0]!).toBe(false);
  });

  it("counts every line of a new skill as added and reports no diff", async () => {
    const s = await setup();
    await newSkill(s, "fresh", 1_000, "one\ntwo\nthree");
    await newSkill(s, "blank", 2_000, "  \n");
    const { proposals } = await s.listProposalSummaries(s.store, {});
    const byName = new Map(proposals.map((p) => [p.skillName, p]));
    expect(byName.get("fresh")).toMatchObject({
      added: 3,
      removed: 0,
      hasDiff: false,
      draftedBy: "agent",
    });
    // A blank body counts no lines, like the page's own count.
    expect(byName.get("blank")).toMatchObject({ added: 0, removed: 0, hasDiff: false });
  });

  it("lists newest first and breaks a tie by insertion order", async () => {
    const s = await setup();
    await improvement(s, "old", 1_000);
    await improvement(s, "tie-first", 2_000);
    await improvement(s, "tie-second", 2_000);
    await improvement(s, "new", 3_000);
    const names = (await s.listProposalSummaries(s.store, {})).proposals.map((p) => p.skillName);
    expect(names).toEqual(["new", "tie-second", "tie-first", "old"]);
    // The full list uses the same order.
    const full = (await allProposals(s.store, {})).map((p) => p.skillName);
    expect(names).toEqual(full);
  });

  it("filters by state, skill name and skill path", async () => {
    const s = await setup();
    const a = await improvement(s, "alpha", 1_000);
    await improvement(s, "beta", 2_000);
    await s.updateProposalState(s.store, a.id, "rejected", 3_000);
    const state = await s.listProposalSummaries(s.store, { state: "rejected" });
    expect(state.proposals.map((p) => p.skillName)).toEqual(["alpha"]);
    const name = await s.listProposalSummaries(s.store, { skillName: "beta" });
    expect(name.proposals.map((p) => p.skillName)).toEqual(["beta"]);
    const path = await s.listProposalSummaries(s.store, { skillPath: "/skills/alpha/SKILL.md" });
    expect(path.proposals.map((p) => p.skillName)).toEqual(["alpha"]);
    const none = await s.listProposalSummaries(s.store, { state: "applied" });
    expect(none).toEqual({ proposals: [], total: 0 });
  });

  it("pages the list and keeps the full total", async () => {
    const s = await setup();
    for (let i = 1; i <= 5; i++) await improvement(s, `skill-${i}`, i * 1_000);
    const page = await s.listProposalSummaries(s.store, {}, { limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.proposals.map((p) => p.skillName)).toEqual(["skill-4", "skill-3"]);
    const past = await s.listProposalSummaries(s.store, {}, { limit: 2, offset: 9 });
    expect(past).toEqual({ proposals: [], total: 5 });
  });

  it("returns an empty list for a missing skills.db without creating it", async () => {
    const s = await setup(false);
    expect(await s.listProposalSummaries(s.store, {})).toEqual({ proposals: [], total: 0 });
    expect(await s.proposalLineCounts(s.store, ["x"])).toEqual(new Map());
  });

  it("names its columns and reads the large ones only for the ids it is given", async () => {
    const s = await setup();
    for (let i = 1; i <= 4; i++) await improvement(s, `skill-${i}`, i * 1_000);
    const db = await s.store.existingDb();
    const seen: { sql: string; args: unknown }[] = [];
    const all = db!.all.bind(db!) as (sql: string, args?: unknown) => Promise<unknown[]>;
    (db as unknown as { all: typeof all }).all = async (sql, args) => {
      seen.push({ sql, args });
      return all(sql, args);
    };
    const page = await s.listProposalSummaries(s.store, {}, { limit: 2, offset: 0 });
    const list = seen.find((q) => /FROM skill_proposals/.test(q.sql) && !/json_each/.test(q.sql));
    expect(list).toBeDefined();
    expect(list!.sql).not.toContain("*");
    expect(list!.sql).not.toContain("proposed_content");
    expect(list!.sql).not.toMatch(/\bdiff\b/);
    const counts = seen.find((q) => /json_each/.test(q.sql));
    expect(counts).toBeDefined();
    // Only the two ids on the page go to the line count query.
    expect(JSON.parse((counts!.args as string[])[0]!)).toEqual(page.proposals.map((p) => p.id));
  });
});
