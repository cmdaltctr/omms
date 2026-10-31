import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const OLD = "---\nname: s-web-search\n---\nOld body\n";
const NEW = "---\nname: s-web-search\n---\nNew body\n";

let baseDir: string;
let skillsDir: string;

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const apply = await import("../src/services/skill-learning/apply.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const deps = { store, folders: [skillsDir], now: () => 5_000 };
  return { store, deps, ...proposals, ...apply };
}

function addSkill(name: string, content = OLD): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function improve(s: Setup, path: string, base = OLD, content = NEW) {
  return s.createProposal(
    s.store,
    {
      kind: "improve",
      skillName: "s-web-search",
      skillPath: path,
      baseHash: s.hashSkillContent(base),
      content,
      diff: "-Old body\n+New body",
      summary: "Better body",
      evidenceTurnIds: [1, 2],
    },
    1_000
  );
}

async function newSkill(s: Setup, name: string, path = join(skillsDir, name, "SKILL.md")) {
  return s.createProposal(
    s.store,
    {
      kind: "new",
      skillName: name,
      skillPath: path,
      baseHash: null,
      content: `---\nname: ${name}\n---\nBody\n`,
      diff: "",
      summary: "A new skill",
      evidenceTurnIds: [],
    },
    1_000
  );
}

describe("apply and undo a skill proposal", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-apply-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("applies an improvement, saves the previous content and leaves no temp file", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    const result = await s.applyProposal(proposal.id, "person", s.deps);
    expect(result).toMatchObject({ ok: true, code: "applied" });
    expect(readFileSync(path, "utf8")).toBe(NEW);
    expect(readdirSync(join(skillsDir, "s-web-search"))).toEqual(["SKILL.md"]);
    const saved = await s.getProposal(s.store, proposal.id);
    expect(saved).toMatchObject({ state: "applied", appliedBy: "person", updatedAt: 5_000 });
    const version = await s.getLatestVersion(s.store, proposal.id);
    expect(version?.previousContent).toBe(OLD);
    expect(version?.writtenHash).toBe(s.hashSkillContent(NEW));
  });

  it("records an automatic apply", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    await s.applyProposal(proposal.id, "automatic", s.deps);
    expect((await s.getProposal(s.store, proposal.id))?.appliedBy).toBe("automatic");
  });

  it("refuses a skill folder that links outside every watched folder and leaves the file", async () => {
    const outside = join(baseDir, "outside", "linked");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "SKILL.md"), OLD);
    symlinkSync(outside, join(skillsDir, "linked"), "dir");
    const s = await setup();
    const proposal = await improve(s, join(skillsDir, "linked", "SKILL.md"));
    const result = await s.applyProposal(proposal.id, "person", s.deps);
    expect(result).toMatchObject({ ok: false, code: "outside-folder" });
    expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe(OLD);
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("pending");
    expect(await s.getLatestVersion(s.store, proposal.id)).toBeNull();
  });

  it("refuses a file that is not named SKILL.md", async () => {
    mkdirSync(join(skillsDir, "s-web-search"));
    const path = join(skillsDir, "s-web-search", "README.md");
    writeFileSync(path, OLD);
    const s = await setup();
    const proposal = await improve(s, path);
    expect(await s.applyProposal(proposal.id, "person", s.deps)).toMatchObject({
      ok: false,
      code: "not-skill-file",
    });
    expect(readFileSync(path, "utf8")).toBe(OLD);
  });

  it("marks the proposal stale after a manual edit and keeps the edit", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    writeFileSync(path, "my own edit\n");
    const result = await s.applyProposal(proposal.id, "automatic", s.deps);
    expect(result).toMatchObject({ ok: false, code: "stale" });
    expect(readFileSync(path, "utf8")).toBe("my own edit\n");
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("stale");
    expect(await s.getLatestVersion(s.store, proposal.id)).toBeNull();
  });

  it("does not overwrite an existing file with a new-skill proposal", async () => {
    const path = addSkill("taken", "existing\n");
    const s = await setup();
    const proposal = await newSkill(s, "taken");
    expect(await s.applyProposal(proposal.id, "person", s.deps)).toMatchObject({
      ok: false,
      code: "exists",
    });
    expect(readFileSync(path, "utf8")).toBe("existing\n");
  });

  it("refuses a new skill name that is not lower-case kebab case", async () => {
    const s = await setup();
    const proposal = await newSkill(s, "Bad_Name");
    expect(await s.applyProposal(proposal.id, "person", s.deps)).toMatchObject({
      ok: false,
      code: "invalid-name",
    });
    expect(existsSync(join(skillsDir, "Bad_Name"))).toBe(false);
  });

  it("refuses to apply a proposal that is not pending", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    await s.applyProposal(proposal.id, "person", s.deps);
    expect(await s.applyProposal(proposal.id, "person", s.deps)).toMatchObject({
      ok: false,
      code: "not-pending",
    });
    expect(await s.applyProposal("missing", "person", s.deps)).toMatchObject({
      ok: false,
      code: "not-found",
    });
  });

  it("undo restores the previous content", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    await s.applyProposal(proposal.id, "automatic", s.deps);
    const result = await s.undoProposal(proposal.id, s.deps);
    expect(result).toMatchObject({ ok: true, code: "undone" });
    expect(readFileSync(path, "utf8")).toBe(OLD);
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("undone");
    expect(readdirSync(join(skillsDir, "s-web-search"))).toEqual(["SKILL.md"]);
  });

  it("undo refuses after an edit and returns the saved content", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    await s.applyProposal(proposal.id, "person", s.deps);
    writeFileSync(path, "edited after apply\n");
    const result = await s.undoProposal(proposal.id, s.deps);
    expect(result).toMatchObject({ ok: false, code: "changed", savedContent: OLD });
    expect(readFileSync(path, "utf8")).toBe("edited after apply\n");
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("applied");
  });

  it("undo of a new skill deletes the file and its empty folder", async () => {
    const s = await setup();
    const proposal = await newSkill(s, "fresh-skill");
    const applied = await s.applyProposal(proposal.id, "agent", s.deps);
    expect(applied).toMatchObject({ ok: true, code: "applied" });
    const path = join(skillsDir, "fresh-skill", "SKILL.md");
    expect(readFileSync(path, "utf8")).toContain("name: fresh-skill");
    expect((await s.getLatestVersion(s.store, proposal.id))?.previousContent).toBeNull();
    expect(await s.undoProposal(proposal.id, s.deps)).toMatchObject({ ok: true, code: "undone" });
    expect(existsSync(join(skillsDir, "fresh-skill"))).toBe(false);
    expect(existsSync(skillsDir)).toBe(true);
  });

  it("undo refuses a proposal that was never applied", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    expect(await s.undoProposal(proposal.id, s.deps)).toMatchObject({
      ok: false,
      code: "not-applied",
    });
  });
});
