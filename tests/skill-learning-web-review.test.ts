import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";
import { CONFIG } from "../src/config.js";
import { SkillStore, skillsDbPath } from "../src/services/skill-learning/store.js";
import {
  webReviewDeps,
  type WebSkillReviewConfig,
} from "../src/services/skill-learning/web-review.js";

/** The web app's review loop reads the config at the start of every tick (design §6). */

let baseDir: string;

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

function config(skillLearning: boolean, folders: string[]): WebSkillReviewConfig {
  return {
    storagePath: baseDir,
    memoryProvider: "openai-chat",
    skillLearning,
    skillFolders: folders,
  };
}

describe("web review deps", () => {
  it("follows a replaced config object between ticks", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-web-review-"));
    CONFIG.storagePath = baseDir;
    const folder = join(baseDir, "skills");
    mkdirSync(folder);
    await new SkillStore(skillsDbPath(baseDir)).init();

    // A reload replaces the CONFIG object; the getter returns the current one.
    let current = config(false, [folder]);
    const tick = webReviewDeps(() => current);
    expect(await tick()).toBeNull();

    current = config(true, [folder]);
    const deps = await tick();
    expect(deps).not.toBeNull();
    expect(deps!.folders).toEqual([folder]);

    current = config(false, [folder]);
    expect(await tick()).toBeNull();
  });

  it("builds no deps and creates no skills.db before a turn is recorded", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-web-review-"));
    CONFIG.storagePath = baseDir;
    const tick = webReviewDeps(() => config(true, []));
    expect(await tick()).toBeNull();
    expect(await new SkillStore(skillsDbPath(baseDir)).existingDb()).toBeNull();
  });
});
