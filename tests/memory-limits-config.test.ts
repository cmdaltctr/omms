import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const configUrl = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;
const jsoncUrl = pathToFileURL(join(import.meta.dir, "../src/services/jsonc.js")).href;

/**
 * Each scenario runs in a child process with a temp HOME because config.js
 * resolves its paths and writes the template at import time. Seed files are
 * written before the import, so omitting `global` mirrors a fresh install.
 */
async function limitsScenario(
  files: { global?: string; project?: string },
  body: string
): Promise<any> {
  const home = mkdtempSync(join(tmpdir(), "omms-limits-home-"));
  tempDirs.push(home);
  const project = mkdtempSync(join(tmpdir(), "omms-limits-project-"));
  tempDirs.push(project);
  const globalPath = join(home, ".config", "omms", "omms.jsonc");
  const projectPath = join(project, ".opencode", "omms.jsonc");
  if (files.global !== undefined) {
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(globalPath, files.global);
  }
  if (files.project !== undefined) {
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(projectPath, files.project);
  }
  const script = `
const { writeFileSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const cfg = await import(${JSON.stringify(configUrl)});
const { stripJsoncComments } = await import(${JSON.stringify(jsoncUrl)});
const home = ${JSON.stringify(home)};
const globalPath = ${JSON.stringify(globalPath)};
const project = ${JSON.stringify(project)};
try {
  const result = await (async () => { ${body} })();
  console.log("LIMITS_RESULT:" + JSON.stringify(result));
} catch (error) {
  console.log("LIMITS_RESULT:" + JSON.stringify({ error: String(error) }));
}
`;
  const dir = mkdtempSync(join(tmpdir(), "omms-limits-script-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_SKIP_LEGACY_MIGRATION: "1",
      OMMS_LOG_FILE: join(home, "omms.log"),
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/LIMITS_RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

describe("memory limit file configuration", () => {
  it("applies the five documented defaults when no values are set", async () => {
    const result = await limitsScenario(
      { global: "{}\n" },
      `
      cfg.initConfig(project);
      return {
        maxMemories: cfg.CONFIG.maxMemories,
        autoCapture: cfg.CONFIG.autoCaptureMaxContextBytes,
        userProfile: cfg.CONFIG.userProfileMaxContextBytes,
        retrieval: cfg.CONFIG.retrievalMaxTokens,
      };
    `
    );
    expect(result).toEqual({
      maxMemories: 10,
      autoCapture: 131072,
      userProfile: 32768,
      retrieval: 2000,
    });
  });

  it("applies a hand-edited global file with all five settings and no web server", async () => {
    const result = await limitsScenario(
      {
        global: JSON.stringify({
          maxMemories: 6,
          autoCaptureMaxContextBytes: 65536,
          userProfileMaxContextBytes: 65536,
          retrievalMaxTokens: 3000,
        }),
      },
      `
        cfg.initConfig(project);
        return {
          maxMemories: cfg.CONFIG.maxMemories,
          autoCapture: cfg.CONFIG.autoCaptureMaxContextBytes,
          userProfile: cfg.CONFIG.userProfileMaxContextBytes,
          retrieval: cfg.CONFIG.retrievalMaxTokens,
        };
      `
    );
    expect(result).toEqual({
      maxMemories: 6,
      autoCapture: 65536,
      userProfile: 65536,
      retrieval: 3000,
    });
  });

  it("accepts the exact accepted boundaries for every setting", async () => {
    const result = await limitsScenario(
      { global: "{}\n" },
      `
      const accepted = [
        { maxMemories: 1 },
        { maxMemories: Number.MAX_SAFE_INTEGER },
        { autoCaptureMaxContextBytes: 16384 },
        { autoCaptureMaxContextBytes: 16777216 },
        { userProfileMaxContextBytes: 1024 },
        { userProfileMaxContextBytes: 16777216 },
        { retrievalMaxTokens: 256 },
        { retrievalMaxTokens: 65536 },
      ];
      const errors = [];
      for (const value of accepted) {
        try { cfg.validateGlobalConfig(value); }
        catch (error) { errors.push(String(error)); }
      }
      return { errors };
    `
    );
    expect(result.errors).toEqual([]);
  });

  it("ignores the removed chatMessage keys in an old file with no error and no log line", async () => {
    const result = await limitsScenario(
      {
        global: JSON.stringify({
          maxMemories: 6,
          chatMessage: {
            enabled: false,
            excludeCurrentSession: false,
            maxMemories: 0,
            injectOn: "always",
            maxAgeDays: 14,
          },
        }),
      },
      `
        const { existsSync } = await import("node:fs");
        const logPath = join(home, "omms.log");
        const logText = () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "");
        const validated = (() => {
          try { cfg.validateGlobalConfig(JSON.parse(readFileSync(globalPath, "utf8"))); return null; }
          catch (error) { return String(error); }
        })();
        cfg.initConfig(project);
        const afterInit = { chatMessage: { ...cfg.CONFIG.chatMessage }, maxMemories: cfg.CONFIG.maxMemories };
        writeFileSync(globalPath, JSON.stringify({ maxMemories: 7,
          chatMessage: { maxMemories: 0, injectOn: "always", maxAgeDays: 14 } }));
        cfg.refreshConfigIfChanged(project);
        return { validated, afterInit, afterRefresh: cfg.CONFIG.maxMemories, log: logText() };
      `
    );
    expect(result.validated).toBeNull();
    expect(result.afterInit).toEqual({
      chatMessage: { enabled: false, excludeCurrentSession: false },
      maxMemories: 6,
    });
    // The old file was read as a valid file: the live reload applied its new value.
    expect(result.afterRefresh).toBe(7);
    expect(result.log).toBe("");
  });

  it("rejects wrong types, fractions, and out-of-range values naming the setting and its accepted values", async () => {
    const result = await limitsScenario(
      { global: "{}\n" },
      `
      const invalid = [
        ["retrievalMaxTokens", 0], ["retrievalMaxTokens", 255], ["retrievalMaxTokens", 65537],
        ["retrievalMaxTokens", 2000.5], ["retrievalMaxTokens", null], ["retrievalMaxTokens", "2000"],
        ["maxMemories", 0], ["maxMemories", -1], ["maxMemories", 1.5], ["maxMemories", "3"],
        ["maxMemories", null], ["maxMemories", Number.MAX_SAFE_INTEGER + 1],
        ["userProfileMaxContextBytes", 1023], ["userProfileMaxContextBytes", 16777217],
        ["userProfileMaxContextBytes", 4096.5], ["userProfileMaxContextBytes", null],
        ["autoCaptureMaxContextBytes", 16383], ["autoCaptureMaxContextBytes", 16777217],
        ["autoCaptureMaxContextBytes", null],
        // The value below must never reach the error message: live reload logs it.
        ["retrievalMaxTokens", "SECRET-BAD-VALUE"],
      ];
      const rows = invalid.map(([key, value]) => {
        const config = { [key]: value };
        try { cfg.validateGlobalConfig(config); return { key, error: null }; }
        catch (error) { return { key, error: String(error) }; }
      });
      return { rows };
    `
    );
    const ranges = {
      retrievalMaxTokens: ["256", "65536"],
      maxMemories: ["positive"],
      userProfileMaxContextBytes: ["1024", "16777216"],
      autoCaptureMaxContextBytes: ["16384", "16777216"],
    };
    for (const row of result.rows) {
      expect(row.error, `${row.key} must be rejected`).not.toBeNull();
      expect(row.error).toContain(row.key);
      for (const text of ranges[row.key as keyof typeof ranges]) {
        expect(row.error, `${row.key} error must mention ${text}`).toContain(text);
      }
    }
    // Rejections are metadata-only: the invalid value is never quoted back.
    const secret = result.rows.find((row) => row.error?.includes("SECRET-BAD-VALUE"));
    expect(secret).toBeUndefined();
  });
});

describe("memory limit project overrides", () => {
  it("lets a project override every limit including the budget without changing other projects", async () => {
    const result = await limitsScenario(
      {
        global: JSON.stringify({
          retrievalMaxTokens: 3000,
          maxMemories: 10,
        }),
        project: JSON.stringify({
          retrievalMaxTokens: 1000,
          maxMemories: 6,
          autoCaptureMaxContextBytes: 65536,
          userProfileMaxContextBytes: 8192,
        }),
      },
      `
        const projectB = join(home, "other-project");
        cfg.initConfig(project);
        const inProject = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
          autoCapture: cfg.CONFIG.autoCaptureMaxContextBytes,
          userProfile: cfg.CONFIG.userProfileMaxContextBytes,
        };
        cfg.initConfig(projectB);
        const inOther = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
        };
        return { inProject, inOther };
      `
    );
    expect(result.inProject).toEqual({
      retrieval: 1000,
      maxMemories: 6,
      autoCapture: 65536,
      userProfile: 8192,
    });
    expect(result.inOther).toEqual({ retrieval: 3000, maxMemories: 10 });
  });

  it("a project chatMessage object still replaces the global one under the shallow merge", async () => {
    const result = await limitsScenario(
      {
        global: JSON.stringify({
          chatMessage: { enabled: false, excludeCurrentSession: false, maxMemories: 5 },
        }),
        project: JSON.stringify({ chatMessage: { enabled: true } }),
      },
      `
        cfg.initConfig(project);
        return { ...cfg.CONFIG.chatMessage };
      `
    );
    // The project object has no excludeCurrentSession, so the default (true) applies.
    expect(result).toEqual({ enabled: true, excludeCurrentSession: true });
  });
});

describe("memory limit live hand edits", () => {
  it("applies a valid live edit at the next refresh and keeps the last good config after an invalid one", async () => {
    const result = await limitsScenario(
      { global: JSON.stringify({ retrievalMaxTokens: 2000, maxMemories: 10 }) },
      `
        cfg.initConfig(project);
        const atStart = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
        };
        writeFileSync(globalPath, JSON.stringify({ retrievalMaxTokens: 1000, maxMemories: 6 }));
        cfg.refreshConfigIfChanged(project);
        const afterValid = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
        };
        writeFileSync(globalPath, JSON.stringify({ retrievalMaxTokens: 0, maxMemories: 6 }));
        cfg.refreshConfigIfChanged(project);
        const afterInvalid = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
        };
        writeFileSync(globalPath, JSON.stringify({ retrievalMaxTokens: 4000 }));
        cfg.refreshConfigIfChanged(project);
        return { atStart, afterValid, afterInvalid, afterRecovery: cfg.CONFIG.retrievalMaxTokens };
      `
    );
    expect(result.atStart).toEqual({ retrieval: 2000, maxMemories: 10 });
    expect(result.afterValid).toEqual({ retrieval: 1000, maxMemories: 6 });
    expect(result.afterInvalid).toEqual({ retrieval: 1000, maxMemories: 6 });
    expect(result.afterRecovery).toBe(4000);
  });

  it("keeps the last good config when a live project edit is invalid", async () => {
    const result = await limitsScenario(
      {
        global: JSON.stringify({ maxMemories: 2 }),
        project: JSON.stringify({ retrievalMaxTokens: 1500 }),
      },
      `
        cfg.initConfig(project);
        const before = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
        };
        writeFileSync(join(project, ".opencode", "omms.jsonc"),
          JSON.stringify({ retrievalMaxTokens: 0 }));
        cfg.refreshConfigIfChanged(project);
        const after = {
          retrieval: cfg.CONFIG.retrievalMaxTokens,
          maxMemories: cfg.CONFIG.maxMemories,
        };
        return { before, after };
      `
    );
    expect(result.after).toEqual(result.before);
    expect(result.before).toEqual({ retrieval: 1500, maxMemories: 2 });
  });
});

describe("memory limit config template", () => {
  it("documents all five controls in the generated template and no removed chatMessage keys", async () => {
    const result = await limitsScenario(
      {},
      `
      const path = join(home, ".config", "omms", "omms.jsonc");
      const text = readFileSync(path, "utf8");
      const parsed = JSON.parse(stripJsoncComments(text));
      return {
        matchesTemplate: text === cfg.CONFIG_TEMPLATE,
        maxMemories: parsed.maxMemories,
        chatMessageKeys: Object.keys(parsed.chatMessage ?? {}),
        templateMentionsRemoved: ["maxAgeDays", "injectOn", "OpenCode V1"].some((term) => text.includes(term)),
        autoCapture: parsed.autoCaptureMaxContextBytes,
        userProfile: parsed.userProfileMaxContextBytes,
        retrieval: parsed.retrievalMaxTokens,
      };
    `
    );
    expect(result.matchesTemplate).toBe(true);
    expect(result.maxMemories).toBe(10);
    expect(result.chatMessageKeys).toEqual(["enabled", "excludeCurrentSession"]);
    expect(result.templateMentionsRemoved).toBe(false);
    expect(result.autoCapture).toBe(131072);
    expect(result.userProfile).toBe(32768);
    expect(result.retrieval).toBe(2000);
  });
});
