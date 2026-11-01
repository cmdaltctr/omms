import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const DAY = 86_400_000;
const NOW = 100 * DAY;

let baseDir: string;
let skillsDir: string;
let seq = 0;

async function setup(init = true) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const failures = await import("../src/services/skill-learning/failures.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  if (init) await store.init();
  const index = buildSkillIndex([skillsDir]);
  return { store, index, ...failures };
}

function addSkill(name: string): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`);
  return path;
}

interface CallOptions {
  name?: string;
  input?: string;
  error?: string | null;
}

interface TurnOptions {
  name: string;
  path: string | null;
  at?: number;
  calls?: Array<"ok" | "error"> | Array<CallOptions & { outcome?: "ok" | "error" }>;
  /** Index of the tool call that loaded the skill; -1 for a slash command. */
  position?: number;
  project?: string | null;
}

function turn({ name, path, at, calls, position, project }: TurnOptions) {
  seq += 1;
  const toolCalls = (calls ?? []).map((call) => {
    const spec =
      typeof call === "string"
        ? ({ outcome: call } as CallOptions & { outcome: "ok" | "error" })
        : call;
    const outcome = spec.outcome ?? "error";
    return {
      name: spec.name ?? "Bash",
      input: spec.input ?? "ls",
      outcome: outcome as "ok" | "error",
      error: outcome === "ok" ? null : spec.error === undefined ? "exit 1" : spec.error,
    };
  });
  return {
    turnKey: `pi:s1:u${seq}`,
    host: "pi",
    sessionId: "s1",
    projectTag: null,
    projectName: project === undefined ? "demo" : project,
    provider: null,
    model: null,
    createdAt: at ?? NOW - seq * 1000,
    prompt: "prompt",
    replies: ["reply"],
    redacted: true,
    toolCalls,
    skillUses: [
      {
        name,
        path,
        method: "tool" as const,
        ...(position === undefined ? {} : { position }),
      },
    ],
  };
}

describe("turn failures query", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-failures-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("lists a turn's failed calls by position with capped input and kept null error", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    await s.store.insertTurn(
      turn({
        name: "s-web-search",
        path,
        calls: [
          { name: "Read", input: "short", outcome: "ok" },
          { name: "Bash", input: "x".repeat(21_000), error: "exit 1" },
          { name: "Grep", input: "y".repeat(50), error: null },
          { name: "Sed", input: "z", error: "" },
        ],
      })
    );
    const id = Number((await (await s.store.db()).get("SELECT id FROM turns"))?.id);
    const failures = await s.turnFailures(s.store, id);
    expect(failures).toEqual([
      {
        position: 1,
        name: "Bash",
        input: "x".repeat(20_000),
        inputCut: true,
        error: "exit 1",
      },
      { position: 2, name: "Grep", input: "y".repeat(50), inputCut: false, error: null },
      // An empty error text is no error text, as a null one is.
      { position: 3, name: "Sed", input: "z", inputCut: false, error: null },
    ]);
  });

  it("gives an empty list for a turn with no failed calls and null for a missing turn", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    await s.store.insertTurn(
      turn({ name: "s-web-search", path, calls: [{ input: "ls", outcome: "ok" }] })
    );
    const id = Number((await (await s.store.db()).get("SELECT id FROM turns"))?.id);
    expect(await s.turnFailures(s.store, id)).toEqual([]);
    expect(await s.turnFailures(s.store, id + 100)).toBeNull();
  });

  it("gives an empty list on a missing skills.db and leaves the file missing", async () => {
    addSkill("s-web-search");
    const s = await setup(false);
    expect(await s.turnFailures(s.store, 1)).toEqual([]);
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });
});

describe("failure groups query", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-groups-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("groups by tool name and first error line, splits different lines and null errors", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const multiLine = "ENOENT: no such file\nsecond line\nthird line";
    await s.store.insertTurn(
      turn({
        name: "s-web-search",
        path,
        calls: [
          { name: "Read", input: "a", error: multiLine },
          { name: "Read", input: "b", error: "ENOENT: no such file\nother" },
          { name: "Read", input: "c", error: "permission denied" },
          { name: "Bash", input: "d", error: null },
        ],
      })
    );
    await s.store.insertTurn(
      turn({
        name: "s-web-search",
        path,
        calls: [
          { name: "Read", input: "e", error: "ENOENT: no such file" },
          { name: "Bash", input: "f", error: null },
        ],
      })
    );
    const groups = await s.skillFailureGroups(s.store, { name: "s-web-search", path }, s.index);
    expect(groups.map((g) => [g.name, g.errorLine, g.calls, g.turns])).toEqual([
      ["Read", "ENOENT: no such file", 3, 2],
      ["Bash", null, 2, 2],
      ["Read", "permission denied", 1, 1],
    ]);
  });

  it("cuts a group key at 200 characters", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const long = "E".repeat(300);
    await s.store.insertTurn(
      turn({ name: "s-web-search", path, calls: [{ error: long, input: "a" }] })
    );
    const [group] = await s.skillFailureGroups(s.store, { name: "s-web-search", path }, s.index);
    expect(group?.errorLine).toBe("E".repeat(200));
  });

  it("counts only calls after the skill was used, and every call of a slash command", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    // The skill loads at position 2: the failures at 0 and 1 do not count.
    await s.store.insertTurn(
      turn({
        name: "s-web-search",
        path,
        position: 2,
        calls: [
          { name: "Bash", input: "before", error: "early exit" },
          { name: "Bash", input: "before", error: "early exit" },
          { name: "Read", input: "skill", outcome: "ok" },
          { name: "Bash", input: "after", error: "late exit" },
        ],
      })
    );
    // A slash command loads the skill before every call, so all of them count.
    await s.store.insertTurn(
      turn({
        name: "s-web-search",
        path,
        position: -1,
        calls: [{ name: "Bash", input: "cmd", error: "late exit" }],
      })
    );
    const groups = await s.skillFailureGroups(s.store, { name: "s-web-search", path }, s.index);
    expect(groups.map((g) => [g.name, g.errorLine, g.calls])).toEqual([["Bash", "late exit", 2]]);
  });

  it("measures the position from this skill's own use, not another skill's in the same turn", async () => {
    const path = addSkill("s-web-search");
    const other = addSkill("s-other");
    const s = await setup();
    // s-other loads at position 0, s-web-search at position 2. The failure at
    // position 1 came before s-web-search was used, so it does not count for it.
    const both = turn({
      name: "s-web-search",
      path,
      position: 2,
      calls: [
        { name: "Bash", input: "a", outcome: "ok" },
        { name: "Bash", input: "b", error: "early exit" },
        { name: "Read", input: "skill", outcome: "ok" },
        { name: "Bash", input: "c", error: "late exit" },
      ],
    });
    both.skillUses.push({ name: "s-other", path: other, method: "tool" as const, position: 0 });
    await s.store.insertTurn(both);
    const groups = await s.skillFailureGroups(s.store, { name: "s-web-search", path }, s.index);
    expect(groups.map((g) => [g.name, g.errorLine, g.calls])).toEqual([["Bash", "late exit", 1]]);
  });

  it("keeps only the latest 5 calls of a group, newest first, with time and project", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    for (let i = 0; i < 7; i++) {
      await s.store.insertTurn(
        turn({
          name: "s-web-search",
          path,
          at: NOW - (7 - i) * DAY,
          project: `p${i}`,
          calls: [{ name: "Bash", input: `run ${i}`, error: "exit 1" }],
        })
      );
    }
    const [group] = await s.skillFailureGroups(s.store, { name: "s-web-search", path }, s.index);
    expect(group?.calls).toBe(7);
    expect(group?.turns).toBe(7);
    expect(group?.lastSeenAt).toBe(NOW - DAY);
    expect(group?.latest.map((c) => [c.input, c.projectName])).toEqual([
      ["run 6", "p6"],
      ["run 5", "p5"],
      ["run 4", "p4"],
      ["run 3", "p3"],
      ["run 2", "p2"],
    ]);
    expect(group?.latest.every((c) => c.createdAt > 0)).toBe(true);
  });

  it("gives an empty list for a skill with no counted failure", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    await s.store.insertTurn(
      turn({
        name: "s-web-search",
        path,
        calls: [{ input: "ls", outcome: "ok" }],
      })
    );
    expect(await s.skillFailureGroups(s.store, { name: "s-web-search", path }, s.index)).toEqual(
      []
    );
  });

  it("gives an empty list on a missing skills.db and leaves the file missing", async () => {
    addSkill("s-web-search");
    const s = await setup(false);
    expect(
      await s.skillFailureGroups(s.store, { name: "s-web-search", path: null }, s.index)
    ).toEqual([]);
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });
});
