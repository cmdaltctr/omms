import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  defaultSkillFolders,
  normaliseSkillConfig,
  projectSkillOverride,
} from "../src/services/skill-learning/skill-config.js";
import { CONFIG, initConfig } from "../src/config.js";

const HOME = "/home/someone";

describe("normaliseSkillConfig", () => {
  it("defaults recording to off, redaction to on and folders to unset", () => {
    expect(normaliseSkillConfig({}, HOME)).toEqual({
      skillLearning: false,
      skillLearningRedact: true,
      skillFolders: undefined,
    });
  });

  it("reads the three keys from the file config", () => {
    const config = normaliseSkillConfig(
      { skillLearning: true, skillLearningRedact: false, skillFolders: ["/opt/skills"] },
      HOME
    );
    expect(config.skillLearning).toBe(true);
    expect(config.skillLearningRedact).toBe(false);
    expect(config.skillFolders).toEqual(["/opt/skills"]);
  });

  it("expands ~/ and keeps an empty list as an empty list", () => {
    expect(normaliseSkillConfig({ skillFolders: ["~/.agents/skills"] }, HOME).skillFolders).toEqual(
      [join(HOME, ".agents/skills")]
    );
    expect(normaliseSkillConfig({ skillFolders: [] }, HOME).skillFolders).toEqual([]);
  });

  it("treats one folder written two ways as one entry", () => {
    const folders = normaliseSkillConfig(
      { skillFolders: ["~/skills", join(HOME, "skills")] },
      HOME
    ).skillFolders;
    expect(folders).toEqual([join(HOME, "skills")]);
  });

  it("rejects a relative or non-string folder entry and names the entry", () => {
    expect(() => normaliseSkillConfig({ skillFolders: ["skills"] }, HOME)).toThrow(
      "Invalid skillFolders config: entry 0 needs an absolute path or a path that starts with ~/"
    );
    expect(() => normaliseSkillConfig({ skillFolders: ["/ok", 5] }, HOME)).toThrow(
      "Invalid skillFolders config: entry 1"
    );
    expect(() => normaliseSkillConfig({ skillFolders: ["~other/skills"] }, HOME)).toThrow(
      "Invalid skillFolders config: entry 0"
    );
  });

  it("rejects a folder list that is not a list", () => {
    expect(() => normaliseSkillConfig({ skillFolders: "/opt/skills" }, HOME)).toThrow(
      "Invalid skillFolders config: must be a list"
    );
  });

  it("rejects a switch that is not true or false", () => {
    expect(() => normaliseSkillConfig({ skillLearning: "yes" }, HOME)).toThrow(
      "Invalid skillLearning config"
    );
    expect(() => normaliseSkillConfig({ skillLearningRedact: 0 }, HOME)).toThrow(
      "Invalid skillLearningRedact config"
    );
  });
});

describe("projectSkillOverride", () => {
  it("lets a project turn recording off", () => {
    expect(projectSkillOverride({ skillLearning: false })).toEqual({
      override: { skillLearning: false },
      ignoredTurnOn: false,
    });
  });

  it("ignores a project that turns recording on and reports it", () => {
    expect(projectSkillOverride({ skillLearning: true })).toEqual({
      override: {},
      ignoredTurnOn: true,
    });
  });

  it("ignores a project value for redaction and folders", () => {
    expect(projectSkillOverride({ skillLearningRedact: false, skillFolders: ["/x"] })).toEqual({
      override: {},
      ignoredTurnOn: false,
    });
  });
});

describe("defaultSkillFolders", () => {
  it("lists the shared and Claude Code skill folders that exist", () => {
    const exists = (path: string) =>
      path === join(HOME, ".agents/skills") || path.endsWith("/cc/skills");
    expect(defaultSkillFolders(HOME, "/cc", exists)).toEqual([
      join(HOME, ".agents/skills"),
      join("/cc", "skills"),
    ]);
  });

  it("drops a folder that is missing", () => {
    expect(defaultSkillFolders(HOME, "/cc", () => false)).toEqual([]);
    expect(defaultSkillFolders(HOME, "/cc", (path) => path === join("/cc", "skills"))).toEqual([
      join("/cc", "skills"),
    ]);
  });
});

describe("watched skill folders", () => {
  it("watches a linked folder once and keeps the first spelling", async () => {
    const { mkdtempSync, mkdirSync, rmSync, symlinkSync } = fs;
    const { tmpdir } = await import("node:os");
    const { watchedSkillFolders } = await import("../src/services/skill-learning/skill-folders.js");
    const root = mkdtempSync(join(tmpdir(), "skill-folders-"));
    try {
      const real = join(root, "agents-skills");
      const link = join(root, "claude-skills");
      const other = join(root, "other");
      mkdirSync(real);
      mkdirSync(other);
      symlinkSync(real, link, "dir");
      expect(watchedSkillFolders({ skillFolders: [real, link, other] })).toEqual([real, other]);
      expect(watchedSkillFolders({ skillFolders: [link, real] })).toEqual([link]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("watches the default folders once when ~/.claude/skills links to ~/.agents/skills", async () => {
    const { mkdirSync, rmSync, symlinkSync } = fs;
    const { homedir } = await import("node:os");
    const { watchedSkillFolders } = await import("../src/services/skill-learning/skill-folders.js");
    const agents = join(homedir(), ".agents", "skills");
    const claude = join(homedir(), "claude-test-folder");
    mkdirSync(agents, { recursive: true });
    mkdirSync(claude, { recursive: true });
    symlinkSync(agents, join(claude, "skills"), "dir");
    try {
      expect(watchedSkillFolders({ claudeConfigDir: claude })).toEqual([agents]);
    } finally {
      rmSync(join(homedir(), ".agents"), { recursive: true, force: true });
      rmSync(claude, { recursive: true, force: true });
    }
  });
});

describe("skill learning in the loaded config", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  const normalizePath = (p: unknown) => String(p).replace(/\\/g, "/");

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    initConfig("/nonexistent-project");
  });

  function mockGlobalAndProject(global: object, project: object) {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) return JSON.stringify(project) as any;
      return JSON.stringify(global) as any;
    });
  }

  it("defaults to recording off with redaction on", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.skillLearning).toBe(false);
    expect(CONFIG.skillLearningRedact).toBe(true);
    expect(CONFIG.skillFolders).toBeUndefined();
  });

  it("lets a project turn recording off", () => {
    mockGlobalAndProject({ skillLearning: true }, { skillLearning: false });
    initConfig("/my/project");
    expect(CONFIG.skillLearning).toBe(false);
  });

  it("ignores a project that turns recording on", () => {
    mockGlobalAndProject({}, { skillLearning: true });
    initConfig("/my/project");
    expect(CONFIG.skillLearning).toBe(false);
  });

  it("keeps global recording when the project leaves it unset", () => {
    mockGlobalAndProject({ skillLearning: true }, {});
    initConfig("/my/project");
    expect(CONFIG.skillLearning).toBe(true);
  });

  it("ignores a project value for redaction and folders", () => {
    mockGlobalAndProject(
      { skillLearning: true, skillLearningRedact: true, skillFolders: ["/global/skills"] },
      { skillLearningRedact: false, skillFolders: ["/project/skills"] }
    );
    initConfig("/my/project");
    expect(CONFIG.skillLearningRedact).toBe(true);
    expect(CONFIG.skillFolders).toEqual(["/global/skills"]);
  });
});
