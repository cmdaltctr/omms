import { describe, expect, it } from "bun:test";
import os from "node:os";
import {
  MAX_PLAN_SKILLS,
  buildSkillSource,
  makeScrubContext,
  matchSkillNames,
  safeSkillRows,
  scrubSummary,
  selectSkills,
  type SkillRow,
} from "../src/services/chat/chat-skills.js";

const ctx = makeScrubContext({}, { home: "/Users/sam", user: "sam" });

function row(name: string, over: Partial<SkillRow> = {}): SkillRow {
  return {
    name,
    path: `/skills/${name}/SKILL.md`,
    uses: 0,
    failedTurns: 0,
    attention: 0.5,
    modified: false,
    lastAppliedAt: null,
    ...over,
  };
}

describe("scrubSummary", () => {
  it("removes <private> text", () => {
    expect(scrubSummary("Keep <private>the client name</private> out", ctx)).not.toContain(
      "client name"
    );
  });

  it("redacts an API key", () => {
    const out = scrubSummary("Used sk-abcdefghijklmnopqrstuvwx for the call", ctx);
    expect(out).not.toContain("sk-abcdefgh");
  });

  it("redacts a configured secret", () => {
    const withSecret = makeScrubContext(
      { memoryApiKey: "super-secret-value" },
      { home: "/Users/sam", user: "sam" }
    );
    expect(scrubSummary("key super-secret-value here", withSecret)).not.toContain("super-secret");
  });

  it("turns absolute paths into [path]", () => {
    expect(scrubSummary("Edited /Users/sam/x/SKILL.md today", ctx)).toBe("Edited [path] today");
    expect(scrubSummary("Edited ~/a/b today", ctx)).toBe("Edited [path] today");
    expect(scrubSummary("Edited C:\\Users\\sam\\x today", ctx)).toBe("Edited [path] today");
    expect(scrubSummary("Edited /srv/clients/acme/SKILL.md", ctx)).toBe("Edited [path]");
  });

  it("replaces a Windows path whose folders hold spaces whole", () => {
    const out = scrubSummary("Opened C:\\Users\\John Smith\\x now", ctx);
    expect(out).not.toContain("Smith");
    expect(out).toBe("Opened [path] now");
  });

  it("leaves a single-segment slash command alone", () => {
    expect(scrubSummary("Added the /commit step", ctx)).toBe("Added the /commit step");
  });

  it("replaces the home folder and the OS user name in plain text", () => {
    const out = scrubSummary("Home is /Users/sam and sam wrote it", ctx);
    expect(out).not.toContain("/Users/sam");
    expect(out).not.toMatch(/\bsam\b/);
  });

  it("uses the real home folder and OS user name by default", () => {
    const real = makeScrubContext({});
    const user = os.userInfo().username;
    const text = `Home ${os.homedir()} and user ${user}`;
    const out = scrubSummary(text, real);
    expect(out).not.toContain(os.homedir());
    if (user.length >= 3) expect(out).not.toContain(user);
  });

  it("replaces a file: URL", () => {
    const out = scrubSummary("See file:///Users/sam/notes.md for more", ctx);
    expect(out).toBe("See [path] for more");
  });

  it("strips user info and the query string from an https URL and keeps the rest", () => {
    const out = scrubSummary("Read https://bob:pw@example.com/docs/a?token=abc&x=1 first", ctx);
    expect(out).toBe("Read https://example.com/docs/a first");
  });

  it("turns an email address into [email]", () => {
    expect(scrubSummary("Ask pat@example.com about it", ctx)).toBe("Ask [email] about it");
  });

  it("cuts a long summary to 200 characters", () => {
    const out = scrubSummary("word ".repeat(100), ctx);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses white space", () => {
    expect(scrubSummary("a\n\n  b\t c", ctx)).toBe("a b c");
  });
});

describe("safeSkillRows", () => {
  it("drops names that fail the pattern, are too long, or that the scrub changes", () => {
    const rows = [
      row("s-web-search", { uses: 3 }),
      row("has space", { uses: 3 }),
      row("-leading", { uses: 3 }),
      row("a".repeat(65), { uses: 3 }),
      row("sam", { uses: 3 }),
      row("a@b", { uses: 3 }),
    ];
    expect(safeSkillRows(rows, ctx).map((r) => r.name)).toEqual(["s-web-search"]);
  });

  it("keeps the row with the most uses when two rows share a name, the first on a tie", () => {
    const rows = [
      row("dup", { path: "/a/dup/SKILL.md", uses: 2 }),
      row("dup", { path: "/b/dup/SKILL.md", uses: 5 }),
      row("tie", { path: "/a/tie/SKILL.md", uses: 4 }),
      row("tie", { path: "/b/tie/SKILL.md", uses: 4 }),
    ];
    const kept = safeSkillRows(rows, ctx);
    expect(kept.find((r) => r.name === "dup")?.path).toBe("/b/dup/SKILL.md");
    expect(kept.find((r) => r.name === "tie")?.path).toBe("/a/tie/SKILL.md");
    expect(kept).toHaveLength(2);
  });

  it("cuts the list to 100 names", () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(`skill-${i}`, { uses: 150 - i }));
    expect(safeSkillRows(rows, ctx)).toHaveLength(MAX_PLAN_SKILLS);
  });
});

describe("selectSkills", () => {
  const rows = [
    row("alpha", { uses: 10, failedTurns: 1, attention: 0.2 }),
    row("beta", { uses: 8, failedTurns: 5, attention: 0.6 }),
    row("gamma", { uses: 0, failedTurns: 0, attention: 0.5 }),
    row("delta", { uses: 6, failedTurns: 0, attention: 0.1 }),
  ];

  it("puts named skills first, in plan order, ignoring case, and drops unknown names", () => {
    const picked = selectSkills(rows, ["DELTA", "nope", "alpha"], "none");
    expect(picked.map((r) => r.name)).toEqual(["delta", "alpha"]);
  });

  it("needs-work skips skills with no failed turns and sorts by attention", () => {
    expect(selectSkills(rows, [], "needs-work").map((r) => r.name)).toEqual(["beta", "alpha"]);
  });

  it("most-used skips skills with no uses", () => {
    expect(selectSkills(rows, [], "most-used").map((r) => r.name)).toEqual([
      "alpha",
      "beta",
      "delta",
    ]);
  });

  it("adds intent skills after named skills with no duplicates", () => {
    const picked = selectSkills(rows, ["beta"], "needs-work");
    expect(picked.map((r) => r.name)).toEqual(["beta", "alpha"]);
  });

  it("gives no skills for intent none and no names", () => {
    expect(selectSkills(rows, [], "none")).toEqual([]);
  });

  it("returns at most 6 skills", () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`s${i}x`, { uses: 20 - i }));
    expect(selectSkills(many, [], "most-used")).toHaveLength(6);
  });
});

describe("matchSkillNames", () => {
  const names = ["s-web-search", "ab", "Review", "s-web-search-v2"];

  it("matches a whole token, ignoring case", () => {
    expect(matchSkillNames("what changed in REVIEW lately?", names)).toEqual(["Review"]);
  });

  it("ignores names under 3 characters", () => {
    expect(matchSkillNames("ab is short", names)).toEqual([]);
  });

  it("does not match a name inside a longer hyphenated name", () => {
    expect(matchSkillNames("tell me about s-web-search-v2", ["s-web-search"])).toEqual([]);
    expect(matchSkillNames("tell me about s-web-search.", ["s-web-search"])).toEqual([
      "s-web-search",
    ]);
  });

  it("does not match inside another word", () => {
    expect(matchSkillNames("a preview of things", ["Review"])).toEqual([]);
  });
});

describe("buildSkillSource", () => {
  const entry = (i: number, summary = "x".repeat(200)) => ({
    kind: "applied" as const,
    at: Date.UTC(2026, 9, 1 + i),
    summary,
    appliedBy: "automatic",
    versionId: `v${i}`,
    canUndo: true,
    proposalId: `p${i}`,
    id: `p${i}:applied`,
  });
  const base = row("my-skill", {
    path: "/Users/sam/.agents/skills/my-skill/SKILL.md",
    uses: 12,
    failedTurns: 3,
    attention: 0.31,
    modified: true,
    lastAppliedAt: Date.UTC(2026, 9, 5),
  });

  it("builds a skill source with the facts and no path, version id or undo flag", () => {
    const source = buildSkillSource(base, [entry(1), entry(2)], ctx);
    expect(source.kind).toBe("skill");
    expect(source.id).toBe("my-skill");
    expect(source.skill).toEqual({
      name: "my-skill",
      uses: 12,
      failedTurns: 3,
      attention: 0.31,
      modified: true,
      lastAppliedAt: Date.UTC(2026, 9, 5),
      history: [
        {
          kind: "applied",
          at: Date.UTC(2026, 9, 2),
          summary: "x".repeat(200),
          appliedBy: "automatic",
        },
        {
          kind: "applied",
          at: Date.UTC(2026, 9, 3),
          summary: "x".repeat(200),
          appliedBy: "automatic",
        },
      ],
    });
    const json = JSON.stringify(source);
    expect(json).not.toContain("/Users/sam");
    expect(json).not.toContain("SKILL.md");
    expect(json).not.toContain("versionId");
    expect(json).not.toContain("canUndo");
  });

  it("keeps at most 5 history entries", () => {
    const source = buildSkillSource(
      base,
      [1, 2, 3, 4, 5, 6, 7].map((i) => entry(i)),
      ctx
    );
    expect(source.skill?.history).toHaveLength(5);
  });

  it("scrubs each summary", () => {
    const source = buildSkillSource(
      base,
      [entry(1, "Edited /Users/sam/x/SKILL.md for sam@example.com")],
      ctx
    );
    expect(source.skill?.history[0]?.summary).toBe("Edited [path] for [email]");
    expect(source.text).not.toContain("sam@");
  });

  it("holds a text block under 1,300 characters for 5 entries of 200 characters", () => {
    const source = buildSkillSource(
      base,
      [1, 2, 3, 4, 5].map((i) => entry(i)),
      ctx
    );
    expect(source.text.length).toBeLessThan(1300);
    expect(source.text).toContain("my-skill");
    expect(source.text).toContain("12 uses");
  });

  it("says when the skill is not modified and has no history", () => {
    const source = buildSkillSource(row("plain"), [], ctx);
    expect(source.text).toContain("Modified: no");
    expect(source.skill?.history).toEqual([]);
  });
});
