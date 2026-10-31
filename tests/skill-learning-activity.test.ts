import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const DAY = 86_400_000;
// Midday on UTC day 100, so a day boundary never sits near NOW.
const NOW = 100 * DAY + 12 * 3_600_000;

let baseDir: string;
let skillsDir: string;
let seq = 0;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const activity = await import("../src/services/skill-learning/activity.js");
  const summaries = await import("../src/services/skill-learning/turn-summaries.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  return { store, index: buildSkillIndex([skillsDir]), ...activity, ...summaries };
}

function addSkill(name: string): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`);
  return path;
}

function turn(name: string, path: string, at: number, failed = false, uses = 1) {
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
    prompt: `prompt ${seq}`,
    replies: ["reply"],
    redacted: true,
    toolCalls: [
      { name: "Read", input: "x", outcome: "ok" as const, error: null },
      ...(failed ? [{ name: "Bash", input: "y", outcome: "error" as const, error: "exit 1" }] : []),
    ],
    skillUses: Array.from({ length: uses }, () => ({
      name,
      path,
      method: "tool" as const,
      position: 0,
    })),
  };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "skill-activity-"));
  skillsDir = join(baseDir, "skills");
  mkdirSync(skillsDir);
});

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

describe("turn paging for one skill", () => {
  it("pages with limit and offset and counts every recorded turn", async () => {
    const path = addSkill("alpha");
    const s = await setup();
    for (let i = 0; i < 5; i++) await s.store.insertTurn(turn("alpha", path, NOW - i * 1000));
    const skill = { name: "alpha", path };

    const first = await s.recentSkillTurns(s.store, skill, s.index);
    expect(first).toHaveLength(5);
    const page = await s.recentSkillTurns(s.store, skill, s.index, 2, 1);
    expect(page.map((t) => t.id)).toEqual([first[1]!.id, first[2]!.id]);
    expect(await s.recentSkillTurns(s.store, skill, s.index, 2, 10)).toEqual([]);
    expect(await s.countSkillTurns(s.store, skill, s.index)).toBe(5);
  });

  it("counts turns for a skill with no watched path by name", async () => {
    const s = await setup();
    await s.store.insertTurn(turn("ghost", "/gone/SKILL.md", NOW));
    await s.store.insertTurn(turn("ghost", "/gone/SKILL.md", NOW - 1000));
    const skill = { name: "ghost", path: null };
    expect(await s.countSkillTurns(s.store, skill, s.index)).toBe(2);
    expect(await s.recentSkillTurns(s.store, skill, s.index, 1, 1)).toHaveLength(1);
  });

  it("counts zero when skills.db does not exist", async () => {
    const s = await setup();
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const missing = new SkillStore(skillsDbPath(join(baseDir, "nowhere")));
    expect(await s.countSkillTurns(missing, { name: "x", path: null }, s.index)).toBe(0);
  });
});

describe("daily uses for one skill", () => {
  it("returns exactly 30 zero-filled UTC days ending today, with failed <= uses", async () => {
    const alpha = addSkill("alpha");
    const beta = addSkill("beta");
    const s = await setup();
    await s.store.insertTurn(turn("alpha", alpha, NOW - 1000)); // today
    await s.store.insertTurn(turn("alpha", alpha, NOW - 2000, true)); // today, failed
    await s.store.insertTurn(turn("alpha", alpha, NOW - 2 * DAY, false, 2)); // used twice, one turn
    await s.store.insertTurn(turn("alpha", alpha, NOW - 29 * DAY)); // first day shown
    await s.store.insertTurn(turn("alpha", alpha, NOW - 30 * DAY)); // one day too old
    await s.store.insertTurn(turn("beta", beta, NOW - 1000)); // another skill
    const daily = await s.skillDaily(s.store, s.index, { name: "alpha", path: alpha }, NOW);

    expect(daily).toHaveLength(30);
    expect(daily[29]!.day).toBe(dayOf(NOW));
    expect(daily[0]!.day).toBe(dayOf(NOW - 29 * DAY));
    const days = daily.map((d) => d.day);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(30);
    expect(daily[29]).toEqual({ day: dayOf(NOW), uses: 2, failed: 1 });
    expect(daily[27]).toEqual({ day: dayOf(NOW - 2 * DAY), uses: 1, failed: 0 });
    expect(daily[0]).toEqual({ day: dayOf(NOW - 29 * DAY), uses: 1, failed: 0 });
    expect(daily[28]).toEqual({ day: dayOf(NOW - DAY), uses: 0, failed: 0 });
    for (const d of daily) expect(d.failed).toBeLessThanOrEqual(d.uses);
  });

  it("zero-fills when skills.db does not exist", async () => {
    const s = await setup();
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const missing = new SkillStore(skillsDbPath(join(baseDir, "nowhere")));
    const daily = await s.skillDaily(missing, s.index, { name: "x", path: null }, NOW);
    expect(daily).toHaveLength(30);
    expect(daily.every((d) => d.uses === 0 && d.failed === 0)).toBe(true);
  });
});

describe("activity across all skills", () => {
  it("totals uses and failed turns and lists the top skills by uses then name", async () => {
    const paths: Record<string, string> = {};
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      paths[name] = addSkill(name);
    }
    const s = await setup();
    // j: 3 uses (1 failed). i: 2 uses. a to h: 1 use each. Ties fall to name order.
    await s.store.insertTurn(turn("j", paths.j!, NOW - 1000, true));
    await s.store.insertTurn(turn("j", paths.j!, NOW - 2000));
    await s.store.insertTurn(turn("j", paths.j!, NOW - DAY));
    await s.store.insertTurn(turn("i", paths.i!, NOW - 3000));
    await s.store.insertTurn(turn("i", paths.i!, NOW - 4000));
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      await s.store.insertTurn(turn(name, paths[name]!, NOW - 5 * DAY));
    }
    await s.store.insertTurn(turn("a", paths.a!, NOW - 40 * DAY)); // outside 30 days

    const result = await s.skillActivity(s.store, s.index, NOW, 30);
    expect(result.days).toHaveLength(30);
    expect(result.days[29]).toEqual({ day: dayOf(NOW), uses: 4, failed: 1 });
    expect(result.totals).toEqual({ uses: 13, failed: 1, activeSkills: 10 });
    expect(result.topSkills).toHaveLength(8);
    expect(result.topSkills.map((t) => t.name)).toEqual(["j", "i", "a", "b", "c", "d", "e", "f"]);
    expect(result.topSkills[0]).toEqual({ name: "j", path: paths.j!, uses: 3, failed: 1 });
    for (const d of result.days) expect(d.failed).toBeLessThanOrEqual(d.uses);
  });

  it("limits the window to the requested number of days", async () => {
    const path = addSkill("alpha");
    const s = await setup();
    await s.store.insertTurn(turn("alpha", path, NOW - 2 * DAY));
    await s.store.insertTurn(turn("alpha", path, NOW - 10 * DAY));
    const result = await s.skillActivity(s.store, s.index, NOW, 7);
    expect(result.days).toHaveLength(7);
    expect(result.totals).toEqual({ uses: 1, failed: 0, activeSkills: 1 });
  });

  it("returns zero-filled days and no top skills for an empty store", async () => {
    const s = await setup();
    const result = await s.skillActivity(s.store, s.index, NOW, 30);
    expect(result.days).toHaveLength(30);
    expect(result.topSkills).toEqual([]);
    expect(result.totals).toEqual({ uses: 0, failed: 0, activeSkills: 0 });
  });
});

describe("activity by day, month and year", () => {
  // 20 October 2026, midday UTC. The rest of October is still to come.
  const TODAY = Date.UTC(2026, 9, 20, 12);
  const at = (y: number, m: number, d: number, h = 12, min = 0) => Date.UTC(y, m - 1, d, h, min);

  async function seeded() {
    const alpha = addSkill("alpha");
    const beta = addSkill("beta");
    const s = await setup();
    await s.store.insertTurn(turn("alpha", alpha, at(2024, 2, 10)));
    await s.store.insertTurn(turn("alpha", alpha, at(2024, 2, 29), true));
    await s.store.insertTurn(turn("alpha", alpha, at(2025, 3, 5)));
    await s.store.insertTurn(turn("beta", beta, at(2025, 3, 20)));
    await s.store.insertTurn(turn("beta", beta, at(2025, 3, 21)));
    await s.store.insertTurn(turn("beta", beta, at(2025, 12, 31, 23, 59)));
    await s.store.insertTurn(turn("beta", beta, at(2026, 1, 1, 0, 0)));
    await s.store.insertTurn(turn("alpha", alpha, at(2026, 10, 15)));
    return { s, alpha, beta };
  }

  it("keeps the day count request and adds bucket, series and available", async () => {
    const { s } = await seeded();
    const result = await s.skillActivity(s.store, s.index, TODAY, 30);
    expect(result.bucket).toBe("day");
    expect(result.series).toHaveLength(30);
    expect(result.series[29]).toEqual({ key: "2026-10-20", uses: 0, failed: 0 });
    expect(result.series[24]).toEqual({ key: "2026-10-15", uses: 1, failed: 0 });
    expect(result.days).toStrictEqual(
      result.series.map(({ key, uses, failed }) => ({ day: key, uses, failed }))
    );
    expect(result.totals).toEqual({ uses: 1, failed: 0, activeSkills: 1 });
  });

  it("returns every day of a calendar month, zero-filled, future days included", async () => {
    const { s, alpha } = await seeded();
    const leap = await s.skillActivity(s.store, s.index, TODAY, {
      bucket: "day",
      month: "2024-02",
    });
    expect(leap.series).toHaveLength(29);
    expect(leap.series[0]!.key).toBe("2024-02-01");
    expect(leap.series[28]).toEqual({ key: "2024-02-29", uses: 1, failed: 1 });
    expect(leap.series[9]).toEqual({ key: "2024-02-10", uses: 1, failed: 0 });
    expect(leap.days.map((d) => d.day)).toEqual(leap.series.map((p) => p.key));
    expect(leap.totals).toEqual({ uses: 2, failed: 1, activeSkills: 1 });
    expect(leap.topSkills).toEqual([{ name: "alpha", path: alpha, uses: 2, failed: 1 }]);

    const plain = await s.skillActivity(s.store, s.index, TODAY, {
      bucket: "day",
      month: "2023-02",
    });
    expect(plain.series).toHaveLength(28);
    expect(plain.totals).toEqual({ uses: 0, failed: 0, activeSkills: 0 });
    expect(plain.topSkills).toEqual([]);
    const april = await s.skillActivity(s.store, s.index, TODAY, {
      bucket: "day",
      month: "2025-04",
    });
    expect(april.series).toHaveLength(30);
    const current = await s.skillActivity(s.store, s.index, TODAY, {
      bucket: "day",
      month: "2026-10",
    });
    expect(current.series).toHaveLength(31);
    expect(current.series[30]).toEqual({ key: "2026-10-31", uses: 0, failed: 0 });
    expect(current.series[14]).toEqual({ key: "2026-10-15", uses: 1, failed: 0 });
  });

  it("returns 12 months of one year with the window's top skills and totals", async () => {
    const { s, alpha, beta } = await seeded();
    const y2025 = await s.skillActivity(s.store, s.index, TODAY, { bucket: "month", year: 2025 });
    expect(y2025.bucket).toBe("month");
    expect(y2025.series.map((p) => p.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`)
    );
    expect(y2025.series[2]).toEqual({ key: "2025-03", uses: 3, failed: 0 });
    expect(y2025.series[11]).toEqual({ key: "2025-12", uses: 1, failed: 0 });
    expect(y2025.series[0]).toEqual({ key: "2025-01", uses: 0, failed: 0 });
    expect(y2025.days).toEqual([]);
    expect(y2025.totals).toEqual({ uses: 4, failed: 0, activeSkills: 2 });
    expect(y2025.topSkills).toEqual([
      { name: "beta", path: beta, uses: 3, failed: 0 },
      { name: "alpha", path: alpha, uses: 1, failed: 0 },
    ]);

    const y2026 = await s.skillActivity(s.store, s.index, TODAY, { bucket: "month", year: 2026 });
    expect(y2026.series).toHaveLength(12);
    expect(y2026.series[0]).toEqual({ key: "2026-01", uses: 1, failed: 0 });
    expect(y2026.series[9]).toEqual({ key: "2026-10", uses: 1, failed: 0 });
    expect(y2026.series[11]).toEqual({ key: "2026-12", uses: 0, failed: 0 });
  });

  it("returns one bar per year from the first use to this year", async () => {
    const { s } = await seeded();
    const years = await s.skillActivity(s.store, s.index, TODAY, { bucket: "year" });
    expect(years.bucket).toBe("year");
    expect(years.series).toEqual([
      { key: "2024", uses: 2, failed: 1 },
      { key: "2025", uses: 4, failed: 0 },
      { key: "2026", uses: 2, failed: 0 },
    ]);
    expect(years.days).toEqual([]);
    expect(years.totals).toEqual({ uses: 8, failed: 1, activeSkills: 2 });
  });

  it("lists the months with uses and the years with uses plus this year, newest first", async () => {
    const { s } = await seeded();
    const result = await s.skillActivity(s.store, s.index, TODAY, { bucket: "year" });
    expect(result.available).toEqual({
      months: ["2026-10", "2026-01", "2025-12", "2025-03", "2024-02"],
      years: [2026, 2025, 2024],
    });
  });

  it("adds this year when no use falls in it", async () => {
    const alpha = addSkill("alpha");
    const s = await setup();
    await s.store.insertTurn(turn("alpha", alpha, at(2024, 5, 1)));
    const result = await s.skillActivity(s.store, s.index, TODAY, { bucket: "year" });
    expect(result.available).toEqual({ months: ["2024-05"], years: [2026, 2024] });
    expect(result.series.map((p) => p.key)).toEqual(["2024", "2025", "2026"]);
  });

  it("lists August and September for a store that starts in August", async () => {
    const alpha = addSkill("alpha");
    const s = await setup();
    await s.store.insertTurn(turn("alpha", alpha, at(2026, 8, 14)));
    await s.store.insertTurn(turn("alpha", alpha, at(2026, 9, 2)));
    await s.store.insertTurn(turn("alpha", alpha, at(2026, 10, 19)));
    const result = await s.skillActivity(s.store, s.index, TODAY, { bucket: "month", year: 2026 });
    expect(result.available).toEqual({ months: ["2026-10", "2026-09", "2026-08"], years: [2026] });
    expect(result.series.slice(7, 10).map((p) => p.uses)).toEqual([1, 1, 1]);
  });

  it("returns as many top skills as asked and counts every skill in the window", async () => {
    const { s, alpha } = await seeded();
    // Both skills have 4 uses over all years; the tie falls to name order.
    const one = await s.skillActivity(s.store, s.index, TODAY, { bucket: "year" }, 1);
    expect(one.topSkills).toEqual([{ name: "alpha", path: alpha, uses: 4, failed: 1 }]);
    expect(one.topTotal).toBe(2);
    const all = await s.skillActivity(s.store, s.index, TODAY, { bucket: "year" });
    expect(all.topSkills).toHaveLength(2);
    expect(all.topTotal).toBe(2);
    const march = await s.skillActivity(s.store, s.index, TODAY, {
      bucket: "day",
      month: "2025-03",
    });
    expect(march.topTotal).toBe(2);
    const feb = await s.skillActivity(s.store, s.index, TODAY, { bucket: "day", month: "2024-02" });
    expect(feb.topTotal).toBe(1);
  });

  it("gives this year alone and empty lists for an empty or missing store", async () => {
    const s = await setup();
    const empty = await s.skillActivity(s.store, s.index, TODAY, { bucket: "year" });
    expect(empty.series).toEqual([{ key: "2026", uses: 0, failed: 0 }]);
    expect(empty.available).toEqual({ months: [], years: [2026] });
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const missing = new SkillStore(skillsDbPath(join(baseDir, "nowhere")));
    const none = await s.skillActivity(missing, s.index, TODAY, { bucket: "month", year: 2026 });
    expect(none.series).toHaveLength(12);
    expect(none.available).toEqual({ months: [], years: [2026] });
    expect(none.totals).toEqual({ uses: 0, failed: 0, activeSkills: 0 });
  });
});

describe("activity query parameters", () => {
  const TODAY = Date.UTC(2026, 9, 20, 12);
  const parse = async (q: string) => {
    const { parseActivityQuery } = await import("../src/services/skill-learning/activity-range.js");
    return parseActivityQuery(new URL("http://x/?" + q), TODAY);
  };

  it("defaults to 30 days and keeps the days clamp", async () => {
    expect(await parse("")).toEqual({ bucket: "day", days: 30 });
    expect(await parse("days=7")).toEqual({ bucket: "day", days: 7 });
    expect(await parse("days=9999")).toEqual({ bucket: "day", days: 90 });
    expect(await parse("bucket=day&days=abc")).toEqual({ bucket: "day", days: 30 });
  });

  it("reads a month, a year and the year bucket", async () => {
    expect(await parse("month=2024-02")).toEqual({ bucket: "day", month: "2024-02" });
    expect(await parse("bucket=day&days=7&month=2024-02")).toEqual({
      bucket: "day",
      month: "2024-02",
    });
    expect(await parse("bucket=month")).toEqual({ bucket: "month", year: 2026 });
    expect(await parse("bucket=month&year=2024")).toEqual({ bucket: "month", year: 2024 });
    expect(await parse("bucket=month&year=abc")).toEqual({ bucket: "month", year: 2026 });
    expect(await parse("bucket=month&year=12")).toEqual({ bucket: "month", year: 1970 });
    expect(await parse("bucket=year&year=2024")).toEqual({ bucket: "year" });
  });

  it("clamps the top skill count to 1 to 100, default 8", async () => {
    const { topParam } = await import("../src/services/skill-learning/activity-range.js");
    const top = (q: string) => topParam(new URL("http://x/?" + q));
    expect(top("")).toBe(8);
    expect(top("top=3")).toBe(3);
    expect(top("top=0")).toBe(1);
    expect(top("top=9999")).toBe(100);
    expect(top("top=abc")).toBe(8);
  });

  it("refuses an unknown bucket and a malformed month", async () => {
    for (const q of [
      "bucket=week",
      "month=2024-13",
      "month=2024-1",
      "month=abc",
      "month=1969-12",
    ]) {
      expect(await parse(q), q).toHaveProperty("error");
    }
  });
});

describe("query parameter clamping", () => {
  it("falls back to the default for bad values and clamps to the range", async () => {
    const { intParam } = await import("../src/services/skill-learning/query-params.js");
    const url = (q: string) => new URL("http://x/?" + q);
    expect(intParam(url(""), "n", 1, 200, 20)).toBe(20);
    expect(intParam(url("n=abc"), "n", 1, 200, 20)).toBe(20);
    expect(intParam(url("n="), "n", 1, 200, 20)).toBe(20);
    expect(intParam(url("n=0"), "n", 1, 200, 20)).toBe(1);
    expect(intParam(url("n=-5"), "n", 1, 200, 20)).toBe(1);
    expect(intParam(url("n=9999"), "n", 1, 200, 20)).toBe(200);
    expect(intParam(url("n=7.9"), "n", 1, 200, 20)).toBe(7);
    expect(intParam(url("n=Infinity"), "n", 1, 200, 20)).toBe(20);
  });
});
