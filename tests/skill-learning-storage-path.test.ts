import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, initConfig } from "../src/config.js";
import type { CaptureWorkUnit } from "../src/core/capture.js";
import {
  skillTurnRecorder,
  skillTurnSettingsFor,
} from "../src/services/skill-learning/settings-for.js";

/**
 * `skills.db` sits in the global storage path only (spec: never inside a
 * project folder), and the watched folders are de-duplicated by real path.
 * The global config is a real file in the test home folder.
 */

const globalConfigFile = join(homedir(), ".config", "omms", "omms.jsonc");
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeGlobal(config: object): void {
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(globalConfigFile, JSON.stringify(config));
}

function unit(projectDirectory: string): CaptureWorkUnit {
  return {
    host: "pi",
    hostSessionId: "s1",
    sourceType: "live",
    projectDirectory,
    userPrompt: "fix the build",
    promptId: "u1",
    textResponses: ["done"],
    toolCalls: [],
  } as CaptureWorkUnit;
}

afterEach(() => {
  rmSync(globalConfigFile, { force: true });
  initConfig("/nonexistent-project");
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("skills.db location", () => {
  it("records into the global storage path when a project config sets storagePath", async () => {
    const globalStore = tempDir("skills-global-");
    const project = tempDir("skills-project-");
    const projectStore = join(project, "store");
    writeGlobal({ skillLearning: true, storagePath: globalStore, skillFolders: [] });
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(
      join(project, ".opencode", "omms.jsonc"),
      JSON.stringify({ storagePath: projectStore })
    );
    initConfig(project);
    // Memories still follow the project value.
    expect(CONFIG.storagePath).toBe(projectStore);
    expect(skillTurnSettingsFor(project).storagePath).toBe(globalStore);

    const record = skillTurnRecorder(project);
    expect(record).toBeDefined();
    expect(await record!(unit(project))).toBe("new");
    expect(existsSync(join(globalStore, "skills.db"))).toBe(true);
    expect(existsSync(join(projectStore, "skills.db"))).toBe(false);
  });
});

describe("watched folders in the turn settings", () => {
  it("lists a linked folder once", () => {
    const root = tempDir("skills-linked-");
    const real = join(root, "real");
    const link = join(root, "link");
    mkdirSync(real);
    symlinkSync(real, link, "dir");
    writeGlobal({ skillLearning: true, skillFolders: [real, link] });
    initConfig(root);
    expect(skillTurnSettingsFor(root).folders).toEqual([real]);
  });
});
