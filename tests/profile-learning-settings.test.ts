import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Task 2.3 of unify-profile-learning: the six profile learning settings are global only,
// have defaults, report invalid values with the key and the accepted values, and reset with null.

const KEYS = [
  "userProfileWithoutEmail",
  "userProfileDecayBeforeMerge",
  "userProfilePromptDetail",
  "userProfileValidationEnabled",
  "showUserProfileToasts",
  "userProfileDuringCatchUp",
] as const;

const DEFAULTS = {
  userProfileWithoutEmail: "learn",
  userProfileDecayBeforeMerge: false,
  userProfilePromptDetail: "full",
  userProfileValidationEnabled: false,
  showUserProfileToasts: true,
  userProfileDuringCatchUp: "learn",
};

/** A valid value that differs from the default, for each key. */
const CHANGED = {
  userProfileWithoutEmail: "skip",
  userProfileDecayBeforeMerge: true,
  userProfilePromptDetail: "prompts-only",
  userProfileValidationEnabled: true,
  showUserProfileToasts: false,
  userProfileDuringCatchUp: "pause",
};

/** A rejected value and the accepted values the message must name. */
const INVALID: Record<(typeof KEYS)[number], { value: unknown; accepted: string }> = {
  userProfileWithoutEmail: { value: "ask", accepted: "learn, skip" },
  userProfileDecayBeforeMerge: { value: "yes", accepted: "true, false" },
  userProfilePromptDetail: { value: "short", accepted: "full, prompts-only" },
  userProfileValidationEnabled: { value: "no", accepted: "true, false" },
  showUserProfileToasts: { value: 1, accepted: "true, false" },
  userProfileDuringCatchUp: { value: "stop", accepted: "learn, pause" },
};

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

async function scenario(body: string, seed = "{}\n") {
  const home = mkdtempSync(join(tmpdir(), "omms-profile-learning-settings-"));
  homes.push(home);
  const target = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, seed);
  const url = (path: string) => pathToFileURL(join(import.meta.dir, path)).href;
  const script = `
    const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
    const cfg = await import(${JSON.stringify(url("../src/config.ts"))});
    const { writeGlobalConfigKeys, readGlobalConfigRevision } = await import(${JSON.stringify(url("../src/config-writer.ts"))});
    const { getSettingsSnapshot } = await import(${JSON.stringify(url("../src/services/settings-snapshot.ts"))});
    const { currentConfigProblems } = await import(${JSON.stringify(url("../src/services/config-problems.ts"))});
    const target = ${JSON.stringify(target)};
    const project = ${JSON.stringify(join(home, "project"))};
    const KEYS = ${JSON.stringify(KEYS)};
    const pick = (source) => Object.fromEntries(KEYS.map((key) => [key, source[key]]));
    const output = await (async () => { ${body} })();
    console.log("RESULT:" + JSON.stringify(output));
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_SKIP_LEGACY_MIGRATION: "1" },
  });
  const output = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const result = output.match(/RESULT:(.*)$/m);
  if (!result) throw new Error(output);
  return JSON.parse(result[1]);
}

describe("profile learning settings: parser", () => {
  it("returns the defaults for an empty file config", async () => {
    const { profileLearningSettingsFrom } =
      await import("../src/core/profile-learning/settings.js");
    expect(profileLearningSettingsFrom({})).toEqual(DEFAULTS);
  });

  it("keeps a valid value of every key", async () => {
    const { profileLearningSettingsFrom } =
      await import("../src/core/profile-learning/settings.js");
    expect(profileLearningSettingsFrom(CHANGED)).toEqual(CHANGED);
  });

  for (const key of KEYS) {
    it(`rejects an invalid ${key} and names the key and the accepted values`, async () => {
      const { profileLearningSettingsFrom } =
        await import("../src/core/profile-learning/settings.js");
      const { value, accepted } = INVALID[key];
      expect(() => profileLearningSettingsFrom({ [key]: value })).toThrow(
        `Invalid ${key} config (accepted: ${accepted})`
      );
    });
  }

  it("removes all six keys from project overrides and logs each removed key once", async () => {
    const { removeProfileLearningProjectOverrides } =
      await import("../src/core/profile-learning/settings.js");
    const overrides: Record<string, unknown> = { ...CHANGED, maxMemories: 5 };
    const lines: string[] = [];
    removeProfileLearningProjectOverrides(overrides, (message) => lines.push(message));
    expect(overrides).toEqual({ maxMemories: 5 });
    expect(lines).toHaveLength(KEYS.length);
    for (const key of KEYS) {
      expect(lines.filter((line) => line.includes(key))).toHaveLength(1);
    }
  });

  it("logs nothing when the project config sets none of the keys", async () => {
    const { removeProfileLearningProjectOverrides } =
      await import("../src/core/profile-learning/settings.js");
    const lines: string[] = [];
    removeProfileLearningProjectOverrides({ maxMemories: 5 }, (message) => lines.push(message));
    expect(lines).toEqual([]);
  });

  it("accepts null (reset) and each valid value as an edit, and refuses the rest", async () => {
    const { isProfileLearningKey, isValidProfileLearningEdit } =
      await import("../src/core/profile-learning/settings.js");
    for (const key of KEYS) {
      expect(isProfileLearningKey(key)).toBe(true);
      expect(isValidProfileLearningEdit(key, null)).toBe(true);
      expect(isValidProfileLearningEdit(key, CHANGED[key])).toBe(true);
      expect(isValidProfileLearningEdit(key, DEFAULTS[key])).toBe(true);
      expect(isValidProfileLearningEdit(key, INVALID[key].value)).toBe(false);
    }
    expect(isProfileLearningKey("maxMemories")).toBe(false);
  });
});

describe("profile learning settings: config", () => {
  it("uses the defaults when the file sets nothing, and the template documents every key", async () => {
    const result = await scenario(`
      return { values: pick(cfg.CONFIG), template: cfg.CONFIG_TEMPLATE };
    `);
    expect(result.values).toEqual(DEFAULTS);
    for (const key of KEYS) expect(result.template).toContain(`"${key}"`);
  });

  it("reads valid values from the global file", async () => {
    const result = await scenario(`
      writeFileSync(target, JSON.stringify(${JSON.stringify(CHANGED)}));
      cfg.initConfig(project);
      return pick(cfg.CONFIG);
    `);
    expect(result).toEqual(CHANGED);
  });

  it("ignores all six keys in a project config", async () => {
    const result = await scenario(`
      mkdirSync(project + "/.opencode", { recursive: true });
      writeFileSync(project + "/.opencode/omms.jsonc", JSON.stringify(${JSON.stringify(CHANGED)}));
      cfg.initConfig(project);
      return pick(cfg.CONFIG);
    `);
    expect(result).toEqual(DEFAULTS);
  });

  it("keeps the global value when a project config sets another one", async () => {
    const result = await scenario(`
      writeFileSync(target, JSON.stringify({ userProfileDuringCatchUp: "pause" }));
      mkdirSync(project + "/.opencode", { recursive: true });
      writeFileSync(project + "/.opencode/omms.jsonc", JSON.stringify({ userProfileDuringCatchUp: "learn" }));
      cfg.initConfig(project);
      return cfg.CONFIG.userProfileDuringCatchUp;
    `);
    expect(result).toBe("pause");
  });

  for (const key of KEYS) {
    it(`reports an invalid ${key} as a config problem and uses the default`, async () => {
      const { value, accepted } = INVALID[key];
      const result = await scenario(`
        writeFileSync(target, JSON.stringify({ ${key}: ${JSON.stringify(value)} }));
        cfg.initConfig(project);
        return {
          value: cfg.CONFIG[${JSON.stringify(key)}],
          problems: currentConfigProblems().filter((problem) => problem.key === ${JSON.stringify(key)}),
        };
      `);
      expect(result.value).toBe(DEFAULTS[key]);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].accepted).toBe(accepted);
    });
  }

  it("rejects an invalid value in validateGlobalConfig with the key and accepted values", async () => {
    const result = await scenario(`
      try {
        cfg.validateGlobalConfig({ userProfilePromptDetail: "short" });
        return null;
      } catch (error) {
        return error.message;
      }
    `);
    expect(result).toContain("userProfilePromptDetail");
    expect(result).toContain("full, prompts-only");
  });
});

describe("profile learning settings: Settings page", () => {
  it("lists all six keys as global only, with a project value never winning", async () => {
    const result = await scenario(`
      writeFileSync(target, JSON.stringify({ userProfilePromptDetail: "prompts-only" }));
      cfg.initConfig(project);
      mkdirSync(project + "/.opencode", { recursive: true });
      writeFileSync(project + "/.opencode/omms.jsonc", JSON.stringify({
        userProfilePromptDetail: "full",
        showUserProfileToasts: false,
      }));
      const { settings } = getSettingsSnapshot(project, cfg);
      return Object.fromEntries(KEYS.map((key) => [key, settings[key]]));
    `);
    for (const key of KEYS) expect(result[key]).toBeDefined();
    expect(result.userProfilePromptDetail).toMatchObject({
      value: "prompts-only",
      source: "global",
    });
    expect(result.showUserProfileToasts).toMatchObject({ value: true, source: "default" });
    expect(result.userProfileWithoutEmail).toMatchObject({ value: "learn", source: "default" });
  });

  it("writes valid values from the page", async () => {
    const result = await scenario(`
      await writeGlobalConfigKeys(${JSON.stringify(CHANGED)}, readGlobalConfigRevision());
      return JSON.parse(readFileSync(target, "utf8"));
    `);
    expect(result).toMatchObject(CHANGED);
  });

  it("removes each key when the page sends null", async () => {
    const seed = JSON.stringify({ ...CHANGED, maxMemories: 7 });
    const result = await scenario(
      `
      await writeGlobalConfigKeys(
        Object.fromEntries(KEYS.map((key) => [key, null])),
        readGlobalConfigRevision()
      );
      return JSON.parse(readFileSync(target, "utf8"));
    `,
      seed
    );
    expect(result).toEqual({ maxMemories: 7 });
  });

  it("refuses an invalid value with the key and accepted values, and leaves the file unchanged", async () => {
    const seed = '{\n  "userProfilePromptDetail": "prompts-only"\n}\n';
    const result = await scenario(
      `
      const errors = {};
      for (const [key, value] of Object.entries(${JSON.stringify(
        Object.fromEntries(KEYS.map((key) => [key, INVALID[key].value]))
      )})) {
        try {
          await writeGlobalConfigKeys({ [key]: value }, readGlobalConfigRevision());
          errors[key] = null;
        } catch (error) {
          errors[key] = error.message;
        }
      }
      return { errors, text: readFileSync(target, "utf8") };
    `,
      seed
    );
    for (const key of KEYS) {
      expect(result.errors[key]).toContain(key);
      expect(result.errors[key]).toContain(INVALID[key].accepted);
    }
    expect(result.text).toBe(seed);
  });
});
