import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

/*
 * Characterisation of every per-query turn reader in `skills.db`: ranking,
 * activity, draft turns, turn summaries, failures and agent evidence. Each
 * check reads through the caller's public API on a real store in its own
 * temporary folder, so the moved SQL must give the same rows as before.
 */

const DAY = 86_400_000;
const NOW = 100 * DAY + 12 * 3_600_000;

let baseDir: string;
let skillsDir: string;
let alphaPath: string;
let beta1Path: string;
let gammaPath: string;
let seq = 0;
let savedStoragePath: string | undefined;

function addSkill(folder: string, name: string): string {
  const dir = join(skillsDir, folder, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`);
  return path;
}

type Call = { name: string; input: string; outcome: "ok" | "error"; error: string | null };
type Use = { name: string; path: string | null; method: "tool"; position: number | null };

function turn(at: number, calls: Call[], uses: Use[], projectName: string | null = null) {
  seq += 1;
  return {
    turnKey: `pi:s1:u${seq}`,
    host: seq % 2 === 0 ? "opencode" : "pi",
    sessionId: "s1",
    projectTag: null,
    projectName,
    provider: null,
    model: null,
    createdAt: at,
    prompt: `prompt ${seq} ${"p".repeat(250)}`,
    replies: [`reply ${seq}`],
    redacted: true,
    toolCalls: calls,
    skillUses: uses,
  };
}

const ok = (name = "Read"): Call => ({ name, input: "x", outcome: "ok", error: null });
const err = (error: string | null, name = "Bash", input = "y"): Call => ({
  name,
  input,
  outcome: "error",
  error,
});

async function modules() {
  const { SkillStore, skillsDbPath } = await import("../src/services/storage/skills/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  return {
    SkillStore,
    skillsDbPath,
    buildSkillIndex,
    ranking: await import("../src/services/skill-learning/ranking.js"),
    activity: await import("../src/services/skill-learning/activity.js"),
    draftTurns: await import("../src/services/skill-learning/draft-turns.js"),
    summaries: await import("../src/services/skill-learning/turn-summaries.js"),
    failures: await import("../src/services/skill-learning/failures.js"),
    agent: await import("../src/services/skill-learning/agent-proposals.js"),
    proposals: await import("../src/services/storage/skills/proposals.js"),
  };
}

let m: Awaited<ReturnType<typeof modules>>;
let store: InstanceType<Awaited<ReturnType<typeof modules>>["SkillStore"]>;
let index: ReturnType<Awaited<ReturnType<typeof modules>>["buildSkillIndex"]>;

beforeAll(async () => {
  baseDir = mkdtempSync(join(tmpdir(), "omms-skill-turn-queries-"));
  skillsDir = join(baseDir, "skills");
  alphaPath = addSkill("a", "alpha");
  beta1Path = addSkill("a", "beta");
  // A second watched beta, so a beta use with no path matches neither.
  addSkill("b", "beta");
  gammaPath = addSkill("a", "gamma");
  mkdirSync(join(baseDir, "data"), { recursive: true });
  // The engine opens a file only inside the storage path.
  const { CONFIG } = await import("../src/config.js");
  savedStoragePath = CONFIG.storagePath;
  CONFIG.storagePath = join(baseDir, "data");
  m = await modules();
  store = new m.SkillStore(m.skillsDbPath(join(baseDir, "data")));
  await store.init();
  index = m.buildSkillIndex([skillsDir]);
  const alpha = (position: number | null): Use => ({
    name: "alpha",
    path: alphaPath,
    method: "tool",
    position,
  });
  const turns = [
    // 1: alpha by path, a failure after the use with a two-line error.
    turn(NOW - 1 * DAY, [ok(), err("boom\nsecond line")], [alpha(0)], "proj-a"),
    // 2: alpha with no path (one watched alpha), the failure comes before the use.
    turn(
      NOW - 2 * DAY,
      [err("early"), ok()],
      [{ name: "alpha", path: null, method: "tool", position: 1 }]
    ),
    // 3: beta by path, an empty error text and an input over the cap.
    turn(
      NOW - 3 * DAY,
      [ok(), err("", "Edit", "z".repeat(20_005))],
      [{ name: "beta", path: beta1Path, method: "tool", position: 0 }],
      "proj-b"
    ),
    // 4: a skill no watched folder holds, with a null error text.
    turn(
      NOW - 4 * DAY,
      [err(null, "Write")],
      [{ name: "ghost", path: null, method: "tool", position: null }]
    ),
    // 5: alpha 40 days ago, outside the ranking window but in the month chart.
    turn(NOW - 40 * DAY, [err("old")], [alpha(-1)]),
    // 6: alpha by slash command with a CRLF error, and beta with no path.
    turn(
      NOW - 1 * DAY + 1000,
      [err("boom\r\nthird"), ok("Grep")],
      [alpha(-1), { name: "beta", path: null, method: "tool", position: 0 }]
    ),
    // 7: alpha used twice in one turn, the earliest use counts.
    turn(NOW - 5 * DAY, [ok(), err("late"), err("boom\nx")], [alpha(2), alpha(0)]),
  ];
  for (const t of turns) await store.insertTurn(t);
  const applied = await m.proposals.createProposal(
    store,
    {
      kind: "improve",
      skillName: "alpha",
      skillPath: alphaPath,
      baseHash: "h",
      content: "c",
      diff: null,
      summary: null,
      evidenceTurnIds: [1],
    },
    NOW - 6 * DAY
  );
  await m.proposals.updateProposalState(store, applied.id, "applied", NOW - 3 * DAY, "person");
  const ghost = await m.proposals.createProposal(
    store,
    {
      kind: "new",
      skillName: "ghost",
      skillPath: null,
      baseHash: null,
      content: "c",
      diff: null,
      summary: null,
      evidenceTurnIds: [],
    },
    NOW - 7 * DAY
  );
  await m.proposals.updateProposalState(store, ghost.id, "applied", NOW - 2 * DAY, "agent");
  await m.proposals.setSkillMode(store, gammaPath, "automatic");
  await m.proposals.setSkillReview(store, beta1Path, NOW - 10 * DAY, 0);
});

afterAll(async () => {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = savedStoragePath!;
  await cleanupTursoTestDirectory(baseDir);
});

const nonZero = (series: { key: string; uses: number; failed: number }[]) =>
  series.filter((p) => p.uses > 0 || p.failed > 0);

const rel = (path: string | null) => (path === null ? null : path.slice(skillsDir.length));

describe("ranking reads", () => {
  it("ranks every skill with its counts, modes and apply times", async () => {
    const rows = await m.ranking.rankSkills(store, index, NOW);
    expect(rows.map((r) => ({ ...r, path: rel(r.path) }))).toEqual([
      {
        name: "alpha",
        path: "/a/alpha/SKILL.md",
        notInWatchedFolder: false,
        uses: 4,
        failedTurns: 3,
        attention: 0.67,
        lastUsedAt: NOW - DAY + 1000,
        mode: "manual",
        suggested: false,
        modified: true,
        lastAppliedAt: NOW - 3 * DAY,
      },
      {
        name: "beta",
        path: null,
        notInWatchedFolder: true,
        uses: 1,
        failedTurns: 0,
        attention: 0.33,
        lastUsedAt: NOW - DAY + 1000,
        mode: "manual",
        suggested: false,
        modified: false,
        lastAppliedAt: null,
      },
      {
        name: "beta",
        path: "/a/beta/SKILL.md",
        notInWatchedFolder: false,
        uses: 1,
        failedTurns: 1,
        attention: 0.67,
        lastUsedAt: NOW - 3 * DAY,
        mode: "manual",
        suggested: false,
        modified: false,
        lastAppliedAt: null,
      },
      {
        name: "ghost",
        path: null,
        notInWatchedFolder: true,
        uses: 1,
        failedTurns: 1,
        attention: 0.67,
        lastUsedAt: NOW - 4 * DAY,
        mode: "manual",
        suggested: false,
        modified: true,
        lastAppliedAt: NOW - 2 * DAY,
      },
      {
        name: "beta",
        path: "/b/beta/SKILL.md",
        notInWatchedFolder: false,
        uses: 0,
        failedTurns: 0,
        attention: 0.5,
        lastUsedAt: null,
        mode: "manual",
        suggested: false,
        modified: false,
        lastAppliedAt: null,
      },
      {
        name: "gamma",
        path: "/a/gamma/SKILL.md",
        notInWatchedFolder: false,
        uses: 0,
        failedTurns: 0,
        attention: 0.5,
        lastUsedAt: null,
        mode: "automatic",
        suggested: false,
        modified: false,
        lastAppliedAt: null,
      },
    ]);
  });
});

describe("activity reads", () => {
  it("counts one skill's daily uses for a path and for no path", async () => {
    const alpha = await m.activity.skillDaily(
      store,
      index,
      { name: "alpha", path: alphaPath },
      NOW
    );
    expect(alpha.filter((d) => d.uses > 0)).toEqual([
      { day: "1970-04-06", uses: 1, failed: 1 },
      { day: "1970-04-09", uses: 1, failed: 0 },
      { day: "1970-04-10", uses: 2, failed: 2 },
    ]);
    const ghost = await m.activity.skillDaily(store, index, { name: "ghost", path: null }, NOW);
    expect(ghost.filter((d) => d.uses > 0)).toEqual([{ day: "1970-04-07", uses: 1, failed: 1 }]);
  });

  it("counts every skill per day, month and year with the top skills", async () => {
    const days = await m.activity.skillActivity(store, index, NOW, 30, 2);
    expect({ ...days, series: nonZero(days.series), days: undefined }).toEqual({
      bucket: "day",
      series: [
        { key: "1970-04-06", uses: 1, failed: 1 },
        { key: "1970-04-07", uses: 1, failed: 1 },
        { key: "1970-04-08", uses: 1, failed: 1 },
        { key: "1970-04-09", uses: 1, failed: 0 },
        { key: "1970-04-10", uses: 3, failed: 2 },
      ],
      days: undefined,
      topSkills: [
        { name: "alpha", path: alphaPath, uses: 4, failed: 3 },
        { name: "beta", path: null, uses: 1, failed: 0 },
      ],
      topTotal: 4,
      totals: { uses: 7, failed: 5, activeSkills: 4 },
      available: { months: ["1970-04", "1970-03"], years: [1970] },
    });
    const months = await m.activity.skillActivity(store, index, NOW, {
      bucket: "month",
      year: 1970,
    });
    expect(nonZero(months.series)).toEqual([
      { key: "1970-03", uses: 1, failed: 1 },
      { key: "1970-04", uses: 7, failed: 5 },
    ]);
    const years = await m.activity.skillActivity(store, index, NOW, { bucket: "year" });
    expect(nonZero(years.series)).toEqual([{ key: "1970", uses: 8, failed: 6 }]);
  });
});

describe("draft turn reads", () => {
  it("counts uses and loads turns with their tool calls", async () => {
    const db = (await store.existingDb())!;
    const ref = m.draftTurns.skillRef(index, alphaPath)!;
    expect(await m.draftTurns.countSkillUses(db, ref)).toBe(5);
    const beta = m.draftTurns.skillRef(index, beta1Path)!;
    expect(await m.draftTurns.countSkillUses(db, beta)).toBe(1);
    const recent = await m.draftTurns.recentSkillTurns(db, ref, 3);
    expect(recent.map((t) => [t.id, t.createdAt, t.replies, t.tools])).toEqual([
      [
        6,
        NOW - DAY + 1000,
        ["reply 6"],
        [
          { name: "Bash", outcome: "error", error: "boom\r\nthird" },
          { name: "Grep", outcome: "ok", error: null },
        ],
      ],
      [
        1,
        NOW - DAY,
        ["reply 1"],
        [
          { name: "Read", outcome: "ok", error: null },
          { name: "Bash", outcome: "error", error: "boom\nsecond line" },
        ],
      ],
      [
        2,
        NOW - 2 * DAY,
        ["reply 2"],
        [
          { name: "Bash", outcome: "error", error: "early" },
          { name: "Read", outcome: "ok", error: null },
        ],
      ],
    ]);
    expect(recent[0]!.prompt.startsWith("prompt 6 ")).toBe(true);
    expect((await m.draftTurns.recentTurns(db, 4)).map((t) => t.id)).toEqual([6, 1, 2, 3]);
    expect((await m.draftTurns.turnsById(db, [5, 3, 99])).map((t) => t.id)).toEqual([3, 5]);
  });
});

describe("turn summary reads", () => {
  it("pages, counts and looks up a skill's turns", async () => {
    const alpha = { name: "alpha", path: alphaPath };
    const page = await m.summaries.recentSkillTurns(store, alpha, index, 2, 1);
    expect(page).toEqual([
      {
        id: 1,
        createdAt: NOW - DAY,
        host: "pi",
        projectName: "proj-a",
        promptPreview: `prompt 1 ${"p".repeat(191)}`,
        failedToolCalls: 1,
      },
      {
        id: 2,
        createdAt: NOW - 2 * DAY,
        host: "opencode",
        projectName: null,
        promptPreview: `prompt 2 ${"p".repeat(191)}`,
        failedToolCalls: 1,
      },
    ]);
    expect(await m.summaries.countSkillTurns(store, alpha, index)).toBe(5);
    const ghost = { name: "ghost", path: null };
    expect(await m.summaries.countSkillTurns(store, ghost, index)).toBe(1);
    expect(
      (await m.summaries.recentSkillTurns(store, ghost, index)).map((t) => t.failedToolCalls)
    ).toEqual([1]);
    const byIds = await m.summaries.skillTurnsByIds(store, [3, 7, 42]);
    expect(byIds.map((t) => [t.id, t.host, t.failedToolCalls])).toEqual([
      [3, "pi", 1],
      [7, "pi", 2],
    ]);
  });
});

describe("failure reads", () => {
  it("lists one turn's failed calls", async () => {
    expect(await m.failures.turnFailures(store, 99)).toBeNull();
    expect(await m.failures.turnFailures(store, 3)).toEqual([
      { position: 1, name: "Edit", input: "z".repeat(20_000), inputCut: true, error: null },
    ]);
    expect(await m.failures.turnFailures(store, 7)).toEqual([
      { position: 1, name: "Bash", input: "y", inputCut: false, error: "late" },
      { position: 2, name: "Bash", input: "y", inputCut: false, error: "boom\nx" },
    ]);
  });

  it("groups a skill's failed calls by tool and first error line", async () => {
    const groups = await m.failures.skillFailureGroups(
      store,
      { name: "alpha", path: alphaPath },
      index
    );
    expect(
      groups.map((g) => ({
        ...g,
        latest: g.latest.map((c) => [c.turnId, c.position, c.error, c.projectName, c.createdAt]),
      }))
    ).toEqual([
      {
        name: "Bash",
        errorLine: "boom",
        calls: 3,
        turns: 3,
        lastSeenAt: NOW - DAY + 1000,
        latest: [
          [6, 0, "boom\r\nthird", null, NOW - DAY + 1000],
          [1, 1, "boom\nsecond line", "proj-a", NOW - DAY],
          [7, 2, "boom\nx", null, NOW - 5 * DAY],
        ],
      },
      {
        name: "Bash",
        errorLine: "late",
        calls: 1,
        turns: 1,
        lastSeenAt: NOW - 5 * DAY,
        latest: [[7, 1, "late", null, NOW - 5 * DAY]],
      },
      {
        name: "Bash",
        errorLine: "old",
        calls: 1,
        turns: 1,
        lastSeenAt: NOW - 40 * DAY,
        latest: [[5, 0, "old", null, NOW - 40 * DAY]],
      },
    ]);
    const ghost = await m.failures.skillFailureGroups(store, { name: "ghost", path: null }, index);
    expect(ghost.map((g) => [g.name, g.errorLine, g.calls])).toEqual([["Write", null, 1]]);
    const beta = await m.failures.skillFailureGroups(
      store,
      { name: "beta", path: beta1Path },
      index
    );
    expect(beta.map((g) => [g.name, g.errorLine, g.latest[0]!.inputCut])).toEqual([
      ["Edit", null, true],
    ]);
  });
});

describe("agent evidence reads", () => {
  it("puts turns with a failure after the use first, with their hosts", async () => {
    const evidence = await m.agent.skillEvidence(alphaPath, 4, { store, index, now: NOW });
    if (!evidence.ok) throw new Error(evidence.message);
    expect(evidence.turns.map((t) => [t.id, t.host, t.failedAfterUse])).toEqual([
      [6, "opencode", true],
      [1, "pi", true],
      [7, "pi", true],
      [2, "opencode", false],
    ]);
  });
});

describe("a missing skills.db", () => {
  it("gives empty reads and stays missing", async () => {
    const empty = new m.SkillStore(m.skillsDbPath(join(baseDir, "data", "none")));
    const skill = { name: "alpha", path: alphaPath };
    expect((await m.ranking.rankSkills(empty, index, NOW)).every((r) => r.uses === 0)).toBe(true);
    expect((await m.activity.skillActivity(empty, index, NOW, 30)).totals.uses).toBe(0);
    expect(await m.summaries.recentSkillTurns(empty, skill, index)).toEqual([]);
    expect(await m.summaries.countSkillTurns(empty, skill, index)).toBe(0);
    expect(await m.failures.turnFailures(empty, 1)).toEqual([]);
    expect(await m.failures.skillFailureGroups(empty, skill, index)).toEqual([]);
    expect(existsSync(join(baseDir, "data", "none", "skills.db"))).toBe(false);
  });
});
