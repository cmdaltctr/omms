import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSkillIndex } from "../src/services/skill-learning/skill-index.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const DAY = 86_400_000;
const NOW = 100 * DAY;

let baseDir: string;
let skillsDir: string;
let seq = 0;

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const { rankSkills } = await import("../src/services/skill-learning/ranking.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const index = buildSkillIndex([skillsDir]);
  return { store, index, rankSkills, proposals };
}

function addSkill(name: string): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`);
  return path;
}

interface TurnOptions {
  name: string;
  path: string | null;
  at: number;
  failed?: boolean;
  methods?: ("tool" | "read" | "command")[];
  /** Outcomes of the tool calls, in order. Replaces the default calls. */
  calls?: ("ok" | "error")[];
  /** Index of the tool call that loaded the skill; -1 for a slash command. */
  position?: number;
}

function turn({
  name,
  path,
  at,
  failed = false,
  methods = ["tool"],
  calls,
  position,
}: TurnOptions) {
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
    prompt: "prompt",
    replies: ["reply"],
    redacted: true,
    toolCalls: calls
      ? calls.map((outcome) => ({
          name: "Bash",
          input: "y",
          outcome,
          error: outcome === "error" ? "exit 1" : null,
        }))
      : [
          { name: "Read", input: "x", outcome: "ok" as const, error: null },
          ...(failed
            ? [{ name: "Bash", input: "y", outcome: "error" as const, error: "exit 1" }]
            : []),
        ],
    skillUses: methods.map((method) => ({
      name,
      path,
      method,
      ...(position === undefined ? {} : { position }),
    })),
  };
}

describe("skill ranking", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-ranking-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("shows 12 uses and 4 failed turns and marks the skill Suggested", async () => {
    const path = addSkill("s-web-search");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 12; i++) {
      await store.insertTurn(
        turn({ name: "s-web-search", path, at: NOW - (i + 1) * DAY, failed: i < 4 })
      );
    }
    const [row] = await rankSkills(store, index, NOW);
    expect(row).toMatchObject({
      name: "s-web-search",
      path,
      notInWatchedFolder: false,
      uses: 12,
      failedTurns: 4,
      lastUsedAt: NOW - DAY,
      mode: "manual",
      suggested: true,
    });
  });

  it("ranks and suggests a skill whose folder is also watched through a link", async () => {
    const path = addSkill("s-web-search");
    const link = join(baseDir, "linked-skills");
    symlinkSync(skillsDir, link, "dir");
    const { store, rankSkills } = await setup();
    const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
    const index = buildSkillIndex([skillsDir, link]);
    for (let i = 0; i < 6; i++) {
      // A use from before the fix, recorded with no path.
      await store.insertTurn(
        turn({ name: "s-web-search", path: null, at: NOW - (i + 1) * DAY, failed: i < 2 })
      );
    }
    const rows = await rankSkills(store, index, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path, notInWatchedFolder: false, uses: 6, suggested: true });
  });

  it("counts only turns from the last 30 days and a turn once when it used the skill twice", async () => {
    const path = addSkill("s-web-search");
    const { store, index, rankSkills } = await setup();
    await store.insertTurn(
      turn({ name: "s-web-search", path, at: NOW - DAY, methods: ["tool", "read"] })
    );
    await store.insertTurn(turn({ name: "s-web-search", path, at: NOW - 31 * DAY, failed: true }));
    const [row] = await rankSkills(store, index, NOW);
    expect(row?.uses).toBe(1);
    expect(row?.failedTurns).toBe(0);
  });

  it("is not Suggested below 5 uses or with no failed turn", async () => {
    const busy = addSkill("busy");
    const few = addSkill("few");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 6; i++) {
      await store.insertTurn(turn({ name: "busy", path: busy, at: NOW - DAY }));
    }
    for (let i = 0; i < 4; i++) {
      await store.insertTurn(turn({ name: "few", path: few, at: NOW - DAY, failed: true }));
    }
    const rows = await rankSkills(store, index, NOW);
    expect(rows.map((r) => [r.name, r.uses, r.suggested])).toEqual([
      ["busy", 6, false],
      ["few", 4, false],
    ]);
  });

  it("notes a skill that has no SKILL.md in a watched folder and never suggests it", async () => {
    addSkill("s-web-search");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 6; i++) {
      await store.insertTurn(turn({ name: "ghost", path: null, at: NOW - DAY, failed: true }));
    }
    const rows = await rankSkills(store, index, NOW);
    expect(rows[0]).toMatchObject({
      name: "ghost",
      path: null,
      notInWatchedFolder: true,
      uses: 6,
      failedTurns: 6,
      suggested: false,
    });
    expect(rows[1]).toMatchObject({ name: "s-web-search", uses: 0, notInWatchedFolder: false });
  });

  it("clears Suggested once a proposal follows the failures, until a new failure", async () => {
    const path = addSkill("s-web-search");
    const { store, index, rankSkills, proposals } = await setup();
    for (let i = 0; i < 12; i++) {
      await store.insertTurn(
        turn({ name: "s-web-search", path, at: NOW - (i + 2) * DAY, failed: i < 4 })
      );
    }
    await proposals.createProposal(
      store,
      {
        kind: "improve",
        skillName: "s-web-search",
        skillPath: path,
        baseHash: "abc",
        content: "new",
        diff: "",
        summary: "",
        evidenceTurnIds: [],
      },
      NOW - DAY - 1
    );
    let [row] = await rankSkills(store, index, NOW);
    expect(row?.failedTurns).toBe(4);
    expect(row?.suggested).toBe(false);

    await store.insertTurn(turn({ name: "s-web-search", path, at: NOW - 1000, failed: true }));
    [row] = await rankSkills(store, index, NOW);
    expect(row?.suggested).toBe(true);
  });

  it("clears Suggested once a manual draft proposes no change, until a new failure", async () => {
    const path = addSkill("s-web-search");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 12; i++) {
      await store.insertTurn(
        turn({ name: "s-web-search", path, at: NOW - (i + 2) * DAY, failed: i < 4 })
      );
    }
    let [row] = await rankSkills(store, index, NOW);
    expect(row?.suggested).toBe(true);

    const { draftImprovement } = await import("../src/services/skill-learning/drafting.js");
    const unchanged = readFileSync(path, "utf8");
    const model = {
      ready: true,
      callTool: async () => ({ success: true, data: { content: unchanged, summary: "" } }),
    };
    const draft = await draftImprovement(path, { store, index, model, now: () => NOW - DAY });
    expect(draft.ok && draft.code).toBe("no-change");
    [row] = await rankSkills(store, index, NOW);
    expect(row?.failedTurns).toBe(4);
    expect(row?.suggested).toBe(false);

    await store.insertTurn(turn({ name: "s-web-search", path, at: NOW - 1000, failed: true }));
    [row] = await rankSkills(store, index, NOW);
    expect(row?.suggested).toBe(true);
  });

  it("shows the saved mode and lists unused watched skills on an empty store", async () => {
    const path = addSkill("auto-skill");
    const { store, index, rankSkills, proposals } = await setup();
    await proposals.setSkillMode(store, path, "automatic");
    const rows = await rankSkills(store, index, NOW);
    expect(rows).toEqual([
      {
        name: "auto-skill",
        path,
        notInWatchedFolder: false,
        uses: 0,
        failedTurns: 0,
        lastUsedAt: null,
        mode: "automatic",
        suggested: false,
        attention: 0.5,
        modified: false,
        lastAppliedAt: null,
      },
    ]);
  });

  it("does not count a failure that came before the skill loaded", async () => {
    const path = addSkill("late");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 6; i++) {
      // Calls: 0 fails, 1 loads the skill, 2 succeeds.
      await store.insertTurn(
        turn({ name: "late", path, at: NOW - DAY, calls: ["error", "ok", "ok"], position: 1 })
      );
    }
    const [row] = await rankSkills(store, index, NOW);
    expect(row).toMatchObject({ uses: 6, failedTurns: 0, suggested: false });
    expect(row?.attention).toBe(0.13);
  });

  it("counts a failure after the skill loaded", async () => {
    const path = addSkill("after");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 6; i++) {
      await store.insertTurn(
        turn({ name: "after", path, at: NOW - DAY, calls: ["ok", "ok", "error"], position: 1 })
      );
    }
    const [row] = await rankSkills(store, index, NOW);
    expect(row).toMatchObject({ uses: 6, failedTurns: 6, suggested: true });
  });

  it("counts every failure in a turn for a slash-command skill", async () => {
    const path = addSkill("slash");
    const { store, index, rankSkills } = await setup();
    for (let i = 0; i < 6; i++) {
      await store.insertTurn(
        turn({
          name: "slash",
          path,
          at: NOW - DAY,
          calls: ["error", "ok"],
          methods: ["command"],
          position: -1,
        })
      );
    }
    const [row] = await rankSkills(store, index, NOW);
    expect(row?.failedTurns).toBe(6);
  });

  it("counts every failure when a use has no recorded position", async () => {
    const path = addSkill("old");
    const { store, index, rankSkills } = await setup();
    await store.insertTurn(turn({ name: "old", path, at: NOW - DAY, calls: ["error", "ok"] }));
    const [row] = await rankSkills(store, index, NOW);
    expect(row?.failedTurns).toBe(1);
  });

  it("uses the earliest use of a skill in a turn", async () => {
    const path = addSkill("twice");
    const { store, index, rankSkills } = await setup();
    const t = turn({ name: "twice", path, at: NOW - DAY, calls: ["ok", "error", "ok", "ok"] });
    t.skillUses = [
      { name: "twice", path, method: "read" as const, position: 3 },
      { name: "twice", path, method: "tool" as const, position: 0 },
    ];
    await store.insertTurn(t);
    const [row] = await rankSkills(store, index, NOW);
    expect(row?.failedTurns).toBe(1);
  });

  describe("attention order", () => {
    async function seedBusyAndRough() {
      const busy = addSkill("busy-skill");
      const rough = addSkill("rough-skill");
      const ctx = await setup();
      for (let i = 0; i < 40; i++) {
        await ctx.store.insertTurn(turn({ name: "busy-skill", path: busy, at: NOW - DAY }));
      }
      for (let i = 0; i < 6; i++) {
        await ctx.store.insertTurn(
          turn({ name: "rough-skill", path: rough, at: NOW - DAY, failed: i < 4 })
        );
      }
      return ctx;
    }

    it("puts the 40-use skill first by default and the 6-use skill first by attention", async () => {
      const { store, index, rankSkills } = await seedBusyAndRough();
      const byUse = await rankSkills(store, index, NOW);
      expect(byUse.map((r) => r.name)).toEqual(["busy-skill", "rough-skill"]);
      const byAttention = await rankSkills(store, index, NOW, "attention");
      expect(byAttention.map((r) => [r.name, r.attention])).toEqual([
        ["rough-skill", 0.63],
        ["busy-skill", 0.02],
      ]);
    });

    it("breaks attention ties by uses, then name", async () => {
      const a = addSkill("a-skill");
      const b = addSkill("b-skill");
      const c = addSkill("c-skill");
      const { store, index, rankSkills } = await setup();
      // attention (0+1)/(2+2)=0.25 for a and b; (0+1)/(1+2)=0.33 for c.
      for (const [name, path, n] of [
        ["a-skill", a, 2],
        ["b-skill", b, 2],
        ["c-skill", c, 1],
      ] as const) {
        for (let i = 0; i < n; i++) {
          await store.insertTurn(turn({ name, path, at: NOW - DAY }));
        }
      }
      const rows = await rankSkills(store, index, NOW, "attention");
      expect(rows.map((r) => r.name)).toEqual(["c-skill", "a-skill", "b-skill"]);
    });

    it("gives 1 use and 1 failure attention 0.67 and does not suggest it", async () => {
      const path = addSkill("one");
      const { store, index, rankSkills } = await setup();
      await store.insertTurn(turn({ name: "one", path, at: NOW - DAY, failed: true }));
      const [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ uses: 1, failedTurns: 1, attention: 0.67, suggested: false });
    });

    it("does not suggest a heavily used skill whose attention is below the minimum", async () => {
      const path = addSkill("steady");
      const { store, index, rankSkills } = await setup();
      for (let i = 0; i < 40; i++) {
        await store.insertTurn(turn({ name: "steady", path, at: NOW - DAY, failed: i < 1 }));
      }
      const [row] = await rankSkills(store, index, NOW);
      // (1+1)/(40+2) = 0.048
      expect(row).toMatchObject({ uses: 40, failedTurns: 1, suggested: false });
      const { SUGGEST_MIN_ATTENTION } = await import("../src/services/skill-learning/ranking.js");
      expect(SUGGEST_MIN_ATTENTION).toBe(0.3);
    });
  });

  describe("modified skills", () => {
    const draft = (name: string, skillPath: string | null) => ({
      kind: "improve" as const,
      skillName: name,
      skillPath,
      baseHash: "abc",
      content: "new",
      diff: "",
      summary: "",
      evidenceTurnIds: [],
    });

    it("marks a skill modified only while a proposal is applied, with the apply time", async () => {
      const path = addSkill("alpha");
      const { store, index, rankSkills, proposals } = await setup();
      const first = await proposals.createProposal(store, draft("alpha", path), NOW - 5 * DAY);
      let [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ modified: false, lastAppliedAt: null });

      await proposals.updateProposalState(store, first.id, "applied", NOW - 4 * DAY, "person");
      [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ modified: true, lastAppliedAt: NOW - 4 * DAY });

      // The newest applied proposal sets the time.
      const second = await proposals.createProposal(store, draft("alpha", path), NOW - 3 * DAY);
      await proposals.updateProposalState(store, second.id, "applied", NOW - 2 * DAY, "agent");
      [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ modified: true, lastAppliedAt: NOW - 2 * DAY });

      // Undoing the newest leaves the older applied proposal.
      await proposals.updateProposalState(store, second.id, "undone", NOW - DAY);
      [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ modified: true, lastAppliedAt: NOW - 4 * DAY });

      await proposals.updateProposalState(store, first.id, "undone", NOW - DAY);
      [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ modified: false, lastAppliedAt: null });
    });

    it("does not count a pending, rejected or stale proposal", async () => {
      const path = addSkill("alpha");
      const { store, index, rankSkills, proposals } = await setup();
      await proposals.createProposal(store, draft("alpha", path), NOW - 5 * DAY);
      const rejected = await proposals.createProposal(store, draft("alpha", path), NOW - 5 * DAY);
      await proposals.updateProposalState(store, rejected.id, "rejected", NOW - 4 * DAY);
      const stale = await proposals.createProposal(store, draft("alpha", path), NOW - 5 * DAY);
      await proposals.updateProposalState(store, stale.id, "stale", NOW - 4 * DAY);
      const [row] = await rankSkills(store, index, NOW);
      expect(row).toMatchObject({ modified: false, lastAppliedAt: null });
    });

    it("matches a proposal by path, and by name only when the proposal has no path", async () => {
      const watched = addSkill("alpha");
      const { store, index, rankSkills, proposals } = await setup();
      // A recorded use of a skill outside the watched folders gives a row with no path.
      await store.insertTurn(turn({ name: "loose", path: null, at: NOW - DAY }));
      await store.insertTurn(turn({ name: "alpha-copy", path: null, at: NOW - DAY }));
      // A pathless proposal named "alpha" must not mark the watched alpha.
      const loose = await proposals.createProposal(store, draft("loose", null), NOW - 3 * DAY);
      await proposals.updateProposalState(store, loose.id, "applied", NOW - 2 * DAY, "person");
      const sameName = await proposals.createProposal(store, draft("alpha", null), NOW - 3 * DAY);
      await proposals.updateProposalState(store, sameName.id, "applied", NOW - 2 * DAY, "person");
      // A proposal with a path never marks a pathless skill of the same name.
      const pathed = await proposals.createProposal(
        store,
        draft("alpha-copy", join(skillsDir, "elsewhere", "SKILL.md")),
        NOW - 3 * DAY
      );
      await proposals.updateProposalState(store, pathed.id, "applied", NOW - DAY, "person");

      const rows = await rankSkills(store, index, NOW);
      const byName = (name: string) => rows.find((r) => r.name === name);
      expect(byName("loose")).toMatchObject({ modified: true, lastAppliedAt: NOW - 2 * DAY });
      expect(byName("alpha-copy")).toMatchObject({ modified: false, lastAppliedAt: null });
      expect(rows.find((r) => r.path === watched)).toMatchObject({
        modified: false,
        lastAppliedAt: null,
      });

      const real = await proposals.createProposal(store, draft("alpha", watched), NOW - 3 * DAY);
      await proposals.updateProposalState(store, real.id, "applied", NOW - DAY, "person");
      const after = await rankSkills(store, index, NOW);
      expect(after.find((r) => r.path === watched)).toMatchObject({
        modified: true,
        lastAppliedAt: NOW - DAY,
      });
    });

    it("reads the proposals in one query however many skills there are", async () => {
      const { store, rankSkills, proposals } = await setup();
      const paths: string[] = [];
      for (let i = 0; i < 12; i++) paths.push(addSkill(`skill-${i}`));
      const many = buildSkillIndex([skillsDir]);
      for (const [i, path] of paths.entries()) {
        const made = await proposals.createProposal(
          store,
          draft(`skill-${i}`, path),
          NOW - 5 * DAY
        );
        if (i < 3) await proposals.updateProposalState(store, made.id, "applied", NOW - DAY);
      }

      const count = async (idx: ReturnType<typeof buildSkillIndex>) => {
        const db = (await store.existingDb())!;
        const seen: string[] = [];
        for (const method of ["all", "get"] as const) {
          const original = db[method].bind(db);
          (db as unknown as Record<string, unknown>)[method] = (sql: string, args?: unknown[]) => {
            if (sql.includes("skill_proposals")) seen.push(sql);
            return original(sql, args as never);
          };
        }
        await rankSkills(store, idx, NOW);
        return seen.length;
      };
      const queries = await count(many);
      const rows = await rankSkills(store, many, NOW);
      expect(rows.filter((r) => r.modified)).toHaveLength(3);
      // The ranking query reads proposals for last_proposal; the modified lookup adds one query.
      expect(queries).toBe(2);
    });
  });
});
