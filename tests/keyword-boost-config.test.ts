import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkedKeywordBoost, checkedKeywordMode } from "../src/utils/keyword-boost.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const configUrl = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;

/** Child process with a temp HOME, so the real config file is never read. */
async function configScenario(globalConfig: string | undefined, projectConfig?: string) {
  const home = mkdtempSync(join(tmpdir(), "omms-boost-cfg-"));
  const project = mkdtempSync(join(tmpdir(), "omms-boost-proj-"));
  tempDirs.push(home, project);
  if (globalConfig !== undefined) {
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(join(home, ".config", "omms", "omms.jsonc"), globalConfig);
  }
  if (projectConfig !== undefined) {
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(join(project, ".opencode", "omms.jsonc"), projectConfig);
  }
  const script = `
try {
  const cfg = await import(${JSON.stringify(configUrl)});
  cfg.initConfig(${JSON.stringify(project)}, { strict: true });
  console.log("BOOST:" + JSON.stringify({ value: cfg.CONFIG.keywordBoost, mode: cfg.CONFIG.keywordMode }));
} catch (error) {
  console.log("BOOST:" + JSON.stringify({ error: String(error) }));
}
`;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_SKIP_LEGACY_MIGRATION: "1" },
  });
  const text = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited, stderr).toBe(0);
  const match = text.match(/BOOST:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]) as { value?: number; mode?: string; error?: string };
}

describe("checkedKeywordBoost", () => {
  it("uses the default when the setting is missing", () => {
    expect(checkedKeywordBoost(undefined)).toBe(0.1);
  });

  it("accepts 0 and 0.5", () => {
    expect(checkedKeywordBoost(0)).toBe(0);
    expect(checkedKeywordBoost(0.5)).toBe(0.5);
  });

  it("refuses values outside 0 to 0.5 and values that are not numbers", () => {
    for (const bad of [0.6, -0.1, Number.NaN, Infinity, "0.2", null, true]) {
      expect(() => checkedKeywordBoost(bad)).toThrow("keywordBoost");
    }
  });

  it("does not quote the value back", () => {
    expect(() => checkedKeywordBoost(0.987)).toThrow(/^(?!.*0\.987)/);
  });
});

describe("keywordBoost in the config file", () => {
  it("defaults to 0.1", async () => {
    expect(await configScenario(undefined)).toMatchObject({ value: 0.1 });
  });

  it("accepts 0 to turn the boost off", async () => {
    expect(await configScenario('{ "keywordBoost": 0 }')).toMatchObject({ value: 0 });
  });

  it("refuses 0.6", async () => {
    const result = await configScenario('{ "keywordBoost": 0.6 }');
    expect(result.error).toContain("keywordBoost");
  });

  it("lets a project file override the global value", async () => {
    expect(
      await configScenario('{ "keywordBoost": 0.1 }', '{ "keywordBoost": 0.3 }')
    ).toMatchObject({ value: 0.3 });
  });
});

describe("checkedKeywordMode", () => {
  it("defaults to boost", () => {
    expect(checkedKeywordMode(undefined)).toBe("boost");
  });

  it("accepts boost and rrf", () => {
    expect(checkedKeywordMode("boost")).toBe("boost");
    expect(checkedKeywordMode("rrf")).toBe("rrf");
  });

  it("refuses any other value without quoting it", () => {
    for (const bad of ["fusion", "RRF", "", 1, null, true]) {
      expect(() => checkedKeywordMode(bad)).toThrow("keywordMode");
    }
    expect(() => checkedKeywordMode("secret-value")).toThrow(/^(?!.*secret-value)/);
  });
});

describe("keywordMode in the config file", () => {
  it("defaults to boost", async () => {
    expect(await configScenario(undefined)).toMatchObject({ mode: "boost" });
  });

  it("accepts rrf", async () => {
    expect(await configScenario('{ "keywordMode": "rrf" }')).toMatchObject({ mode: "rrf" });
  });

  it("refuses an unknown mode", async () => {
    const result = await configScenario('{ "keywordMode": "fusion" }');
    expect(result.error).toContain("keywordMode");
    expect(result.error).not.toContain("fusion");
  });
});
