import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import { parseOperationArgs, runSkillsCommand } from "../src/cli/skills-command.js";
import { hashSkillContent } from "../src/services/skill-learning/apply.js";
import { createProposal, getProposal } from "../src/services/skill-learning/proposal-store.js";
import { SkillStore, skillsDbPath } from "../src/services/skill-learning/store.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

/**
 * `om-memory-system skills` from a terminal and from the Claude Code tool.
 * The global config is a real file in the test home folder; the store and
 * the skills sit in a temporary project folder.
 */

const OLD = "---\nname: s-web-search\ndescription: Search the web\n---\nOld body\n";
const NEW = "---\nname: s-web-search\ndescription: Search the web\n---\nNew body\n";
const globalConfigFile = join(homedir(), ".config", "omms", "omms.jsonc");
const startCwd = process.cwd();

let project: string;
let skillPath: string;
let store: SkillStore;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "skills-cli-"));
  const skillsDir = join(project, "skills");
  mkdirSync(join(skillsDir, "s-web-search"), { recursive: true });
  skillPath = join(skillsDir, "s-web-search", "SKILL.md");
  writeFileSync(skillPath, OLD);
  const storage = join(project, "store");
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(
    globalConfigFile,
    JSON.stringify({ skillLearning: true, storagePath: storage, skillFolders: [skillsDir] })
  );
  process.chdir(project);
  initConfig(project);
  store = new SkillStore(skillsDbPath(storage));
});

afterEach(async () => {
  process.chdir(startCwd);
  rmSync(globalConfigFile, { force: true });
  await cleanupTursoTestDirectory(project);
});

async function seed(): Promise<string> {
  await store.init();
  const proposal = await createProposal(
    store,
    {
      kind: "improve",
      skillName: "s-web-search",
      skillPath,
      baseHash: hashSkillContent(OLD),
      content: NEW,
      diff: "-Old body\n+New body",
      summary: "Explain the failure",
      evidenceTurnIds: [],
    },
    Date.now() - 1_000
  );
  return proposal.id;
}

async function command(argv: string[]) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await runSkillsCommand(
    argv,
    (line) => lines.push(line),
    (line) => errors.push(line)
  );
  return { code, text: lines.join("\n"), errors: errors.join("\n") };
}

describe("skills proposals --json", () => {
  it("prints summaries, and show prints the full proposal", async () => {
    const id = await seed();
    const listed = JSON.parse((await command(["proposals", "--json"])).text);
    expect(listed.data.proposals).toHaveLength(1);
    expect(listed.data.proposals[0]).toMatchObject({
      id,
      state: "pending",
      added: 1,
      removed: 1,
      hasDiff: true,
      canUndo: false,
    });
    expect("content" in listed.data.proposals[0]).toBe(false);
    expect("diff" in listed.data.proposals[0]).toBe(false);
    const shown = JSON.parse((await command(["show", "--id", id, "--json"])).text);
    expect(shown.data.proposal).toMatchObject({ content: NEW, diff: "-Old body\n+New body" });
  });
});

describe("skills apply --applied-by", () => {
  it("records agent with --applied-by agent", async () => {
    const id = await seed();
    const run = await command(["apply", "--id", id, "--applied-by", "agent", "--json"]);
    expect(run.code).toBe(0);
    expect((await getProposal(store, id))?.appliedBy).toBe("agent");
    expect(readFileSync(skillPath, "utf8")).toBe(NEW);
  });

  it("records person without the option", async () => {
    const id = await seed();
    expect((await command(["apply", "--id", id])).code).toBe(0);
    expect((await getProposal(store, id))?.appliedBy).toBe("person");
  });

  it("refuses any other value and applies nothing", async () => {
    const id = await seed();
    const run = await command(["apply", "--id", id, "--applied-by", "robot"]);
    expect(run.code).toBe(1);
    expect(run.errors).toContain("--applied-by");
    expect((await getProposal(store, id))?.state).toBe("pending");
    expect(readFileSync(skillPath, "utf8")).toBe(OLD);
  });
});

describe("skills evidence and propose", () => {
  it("evidence prints the file and its recorded turns as JSON", async () => {
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
    const run = await command(["evidence", "--skill", "s-web-search", "--limit", "5", "--json"]);
    expect(run.code).toBe(0);
    const reply = JSON.parse(run.text);
    expect(reply.data.content).toBe(OLD);
    expect(reply.data.turns).toHaveLength(1);
    expect(reply.data.turns[0].prompt).toBe("search the docs");
  });

  it("propose reads the content from --content-file and saves a pending proposal", async () => {
    const file = join(project, "new-skill.md");
    writeFileSync(file, NEW);
    const run = await command([
      "propose",
      "--skill",
      "s-web-search",
      "--summary",
      "Explain the failure",
      "--content-file",
      file,
      "--json",
    ]);
    expect(run.code).toBe(0);
    const id = JSON.parse(run.text).data.proposal.id;
    expect(await getProposal(store, id)).toMatchObject({
      state: "pending",
      draftedBy: "agent",
      content: NEW,
    });
    expect(readFileSync(skillPath, "utf8")).toBe(OLD);
  });

  it("propose refuses a missing content file", async () => {
    const run = await command(["propose", "--skill", "s-web-search", "--content-file", "/no/file"]);
    expect(run.code).toBe(1);
    expect(run.errors).toContain("/no/file");
  });
});

describe("skills options from the Claude Code tool", () => {
  // The launcher's npx fallback runs from the temp folder, so the tool names the project.
  it("--directory reads that project's config, not the working folder's", async () => {
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(
      join(project, ".opencode", "omms.jsonc"),
      JSON.stringify({ skillLearning: false })
    );
    const elsewhere = mkdtempSync(join(tmpdir(), "skills-cli-cwd-"));
    try {
      process.chdir(elsewhere);
      expect(JSON.parse((await command(["list", "--json"])).text).code).not.toBe("recording-off");
      const run = await command(["list", "--json", "--directory", project]);
      expect(JSON.parse(run.text).code).toBe("recording-off");
    } finally {
      process.chdir(project);
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("passes the idea's reason and evidence turns", () => {
    const { args } = parseOperationArgs([
      "--idea-name",
      "deploy",
      "--idea-description",
      "Deploy steps",
      "--idea-reason",
      "Seen often",
      "--idea-evidence",
      "12,T14",
    ]);
    expect(args.idea).toEqual({
      name: "deploy",
      description: "Deploy steps",
      reason: "Seen often",
      evidenceTurnIds: [12, 14],
    });
  });
});
