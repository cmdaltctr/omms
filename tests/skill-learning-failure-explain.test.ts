import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { allProposals } from "./skill-proposal-helpers.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const logged: Array<{ message: string; meta: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, meta?: unknown) => logged.push({ message, meta }),
}));

const SKILL = "---\nname: s-web-search\ndescription: Search the web\n---\nBody\n";
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

function addSkill(name: string, content = SKILL): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

/** A turn with one failed call of the given tool and error, using the skill. */
function failingTurn(name: string, path: string, tool: string, error: string, input: string) {
  seq += 1;
  return {
    turnKey: `pi:s1:u${seq}`,
    host: "pi",
    sessionId: "s1",
    projectTag: null,
    projectName: "demo",
    provider: null,
    model: null,
    createdAt: NOW - seq * 1000,
    prompt: "PROMPT-SECRET keep out",
    replies: ["REPLY-SECRET keep out"],
    redacted: true,
    toolCalls: [{ name: tool, input, outcome: "error" as const, error }],
    skillUses: [{ name, path, method: "tool" as const }],
  };
}

async function setup(reply: unknown, ready = true) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const explain = await import("../src/services/skill-learning/failure-explain.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const index = buildSkillIndex([skillsDir]);
  const { model, calls } = stubModel(reply, ready);
  const deps = { store, index, model };
  return { store, deps, calls, ...explain };
}

function ok(data: unknown) {
  return { success: true, data };
}

const REPLY = ok({
  summary: "The tool misreads its input",
  causes: [
    {
      kind: "skill",
      explanation: "The skill never says to quote the path",
      actions: ["Add a quoted-path step", " Name an example "],
    },
    { kind: "harness", explanation: "The host drops the argument", actions: [] },
  ],
});

describe("failure explain", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "failure-explain-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
    logged.length = 0;
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("sends the skill file and at most 10 groups with 500-character excerpts, and nothing else", async () => {
    const path = addSkill("s-web-search", SKILL + "UNIQUE-SKILL-BODY\n");
    const s = await setup(REPLY);
    for (let i = 0; i < 12; i++) {
      await s.store.insertTurn(
        failingTurn("s-web-search", path, "Bash", `boom ${i}`, i === 0 ? "a".repeat(2000) : "ls")
      );
    }
    const result = await s.explainFailures({ name: "s-web-search", path }, s.deps);
    expect(result.ok).toBe(true);
    expect(s.calls).toHaveLength(1);
    const user = s.calls[0]!.user;
    // The skill name and its SKILL.md travel with the groups.
    expect(user).toContain("s-web-search");
    expect(user).toContain("UNIQUE-SKILL-BODY");
    // At most 10 groups, most calls first: group 0 has the most calls, so it is kept.
    expect(user.match(/^- Tool: Bash; Error: boom /gm)).toHaveLength(10);
    expect(user).toContain("boom 0");
    expect(user).not.toContain("boom 11");
    // Turn prompts and replies never travel.
    expect(user).not.toContain("PROMPT-SECRET");
    expect(user).not.toContain("REPLY-SECRET");
    // The excerpt of a long input is cut at 500 characters.
    const excerpt = /boom 0;.*Input excerpt: "([^"]*)"/.exec(user);
    expect(excerpt?.[1]).toBe("a".repeat(500));
  });

  it("sends nothing when the external API is not set up", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(REPLY, false);
    await s.store.insertTurn(failingTurn("s-web-search", path, "Bash", "boom", "ls"));
    const result = await s.explainFailures({ name: "s-web-search", path }, s.deps);
    expect(result).toMatchObject({ ok: false, code: "not-configured" });
    expect(s.calls).toHaveLength(0);
  });

  it("sends nothing when the skill has no failure group", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(REPLY);
    const result = await s.explainFailures({ name: "s-web-search", path }, s.deps);
    expect(result).toMatchObject({ ok: false, code: "invalid-args" });
    expect(s.calls).toHaveLength(0);
  });

  it("returns a fixed code and logs the code only when the model fails", async () => {
    const path = addSkill("s-web-search");
    const s = await setup({ success: false, error: "timeout after 10ms" });
    await s.store.insertTurn(failingTurn("s-web-search", path, "Bash", "boom", "ls"));
    const result = await s.explainFailures({ name: "s-web-search", path }, s.deps);
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(logged).toEqual([expect.objectContaining({ meta: { host: null, reason: "timeout" } })]);
  });

  it("returns invalid-reply for a reply outside the schema", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(ok({ summary: "fine", causes: [{ kind: "mystery", explanation: "x" }] }));
    await s.store.insertTurn(failingTurn("s-web-search", path, "Bash", "boom", "ls"));
    const result = await s.explainFailures({ name: "s-web-search", path }, s.deps);
    expect(result).toMatchObject({ ok: false, code: "invalid-reply" });
  });

  it("returns the trimmed reply and saves nothing", async () => {
    const path = addSkill("s-web-search");
    const s = await setup(REPLY);
    await s.store.insertTurn(failingTurn("s-web-search", path, "Bash", "boom", "ls"));
    const before = await allProposals(s.store);
    const result = await s.explainFailures({ name: "s-web-search", path }, s.deps);
    expect(result).toMatchObject({
      ok: true,
      explanation: {
        summary: "The tool misreads its input",
        causes: [
          {
            kind: "skill",
            explanation: "The skill never says to quote the path",
            actions: ["Add a quoted-path step", "Name an example"],
          },
          { kind: "harness", explanation: "The host drops the argument", actions: [] },
        ],
      },
    });
    expect(await allProposals(s.store)).toEqual(before);
  });
});
