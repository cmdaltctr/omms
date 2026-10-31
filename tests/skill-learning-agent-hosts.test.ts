import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

/**
 * The agent path through each host's `skills` tool, over the real operations:
 * `evidence`, then `propose`. The external API is not set up, so a model call
 * would fail; neither mode makes one.
 */

const OLD = "---\nname: s-web-search\ndescription: Search the web\n---\nOld body\n";
const NEW = "---\nname: s-web-search\ndescription: Search the web\n---\nNew body\n";

let baseDir: string;
let skillPath: string;

beforeEach(async () => {
  baseDir = mkdtempSync(join(tmpdir(), "skill-agent-hosts-"));
  const skillsDir = join(baseDir, "skills");
  mkdirSync(join(skillsDir, "s-web-search"), { recursive: true });
  skillPath = join(skillsDir, "s-web-search", "SKILL.md");
  writeFileSync(skillPath, OLD);
  const { CONFIG } = await import("../src/config.js");
  Object.assign(CONFIG, {
    storagePath: baseDir,
    skillLearning: true,
    skillFolders: [skillsDir],
    memoryApiUrl: undefined,
    memoryApiKey: undefined,
    memoryModel: undefined,
  });
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  await store.insertTurn({
    turnKey: "pi:s1:u1",
    host: "pi",
    sessionId: "s1",
    projectTag: null,
    projectName: null,
    provider: null,
    model: null,
    createdAt: Date.now() - 60_000,
    prompt: "search the docs",
    replies: ["I searched"],
    redacted: true,
    toolCalls: [{ name: "Bash", input: "curl", outcome: "error", error: "exit 7" }],
    skillUses: [{ name: "s-web-search", path: skillPath, method: "tool" }],
  });
  const { clearSkillIndexCache } = await import("../src/services/skill-learning/skill-index.js");
  clearSkillIndexCache();
});

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

type Call = (args: Record<string, unknown>) => Promise<any>;

async function agentPath(call: Call) {
  const evidence = await call({ mode: "evidence", skill: "s-web-search" });
  expect(evidence).toMatchObject({ success: true, code: "ok" });
  expect(evidence.data.content).toBe(OLD);
  expect(evidence.data.turns[0].tools[0]).toEqual({
    name: "Bash",
    outcome: "error",
    error: "exit 7",
  });
  const proposed = await call({
    mode: "propose",
    skill: "s-web-search",
    content: NEW,
    summary: "Explain the curl failure",
    evidence: [evidence.data.turns[0].id],
  });
  expect(proposed).toMatchObject({ success: true, code: "proposed" });
  expect(proposed.data.proposal).toMatchObject({ draftedBy: "agent", state: "pending" });
  expect(proposed.data.proposal.diff).toContain("+New body");
  expect(readFileSync(skillPath, "utf8")).toBe(OLD);
}

// `ideas` returns each idea's reason and evidence turns; draft needs both to send the turn text.
it("every host's skills tool takes the idea's reason and evidence turns", async () => {
  const want = ["description", "evidenceTurnIds", "name", "reason"];
  const { SKILLS_TOOL_INPUT_SCHEMA } = await import("../src/core/skills-tool.js");
  expect(Object.keys(SKILLS_TOOL_INPUT_SCHEMA.properties.idea.properties).sort()).toEqual(want);
  const { registerPiSkillsTool } = await import("../src/adapters/pi/skills-tool.js");
  const tools: any[] = [];
  registerPiSkillsTool({ registerTool: (def: any) => tools.push(def) } as any);
  expect(Object.keys(tools[0].parameters.properties.idea.properties).sort()).toEqual(want);
  const { opencodeSkillsTool } = await import("../src/adapters/opencode/skills-tool.js");
  const opencode: any = opencodeSkillsTool(baseDir);
  const idea = { name: "deploy", description: "d", reason: "Seen often", evidenceTurnIds: [3] };
  // OpenCode parses the arguments with the schema, which drops unknown keys.
  expect(opencode.args.idea.parse(idea)).toEqual(idea);
});

describe("the agent fixes a skill through the host tool", () => {
  it("Pi", async () => {
    const { registerPiSkillsTool } = await import("../src/adapters/pi/skills-tool.js");
    const tools: any[] = [];
    registerPiSkillsTool({ registerTool: (def: any) => tools.push(def) } as any);
    const skills = tools[0];
    expect(Object.keys(skills.parameters.properties)).toEqual(
      expect.arrayContaining(["content", "summary", "evidence", "limit"])
    );
    await agentPath(async (args) => {
      const out = await skills.execute("call-1", args, undefined, undefined, { cwd: baseDir });
      return JSON.parse(out.content[0].text);
    });
  });

  it("OpenCode", async () => {
    const { opencodeSkillsTool } = await import("../src/adapters/opencode/skills-tool.js");
    const skills: any = opencodeSkillsTool(baseDir);
    expect(Object.keys(skills.args)).toEqual(
      expect.arrayContaining(["content", "summary", "evidence", "limit"])
    );
    await agentPath(async (args) => JSON.parse(await skills.execute(args, {})));
  });
});
