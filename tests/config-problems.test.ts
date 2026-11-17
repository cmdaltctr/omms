import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ConfigValueError,
  buildTolerant,
  currentConfigProblems,
  describeJsoncError,
  recordConfigProblems,
} from "../src/services/config-problems.js";

const FILE = "/home/user/.config/omms/omms.jsonc";

/** A 14-line file whose line 12 lacks the comma before the key on line 13. */
const MISSING_COMMA = [
  "{",
  "  // Settings",
  '  "storagePath": "~/.omms/data",',
  '  "maxMemories": 10,',
  '  "autoCaptureEnabled": true,',
  '  "injectProfile": true,',
  '  "webServerPort": 4747,',
  '  "webServerHost": "127.0.0.1",',
  '  "deduplicationEnabled": true,',
  '  "captureTrace": false,',
  '  "memoryModel": "secret-looking-model-name",',
  '  "memoryApiUrl": "https://private.example/v1" // trailing note',
  '  "memoryProvider": "openai-chat"',
  "}",
].join("\n");

describe("describeJsoncError", () => {
  it("names the file, line 12, the column after the last value and a plain sentence", () => {
    const problem = describeJsoncError(FILE, MISSING_COMMA, false);
    expect(problem.kind).toBe("parse");
    expect(problem.file).toBe(FILE);
    expect(problem.line).toBe(12);
    expect(problem.column).toBe('  "memoryApiUrl": "https://private.example/v1"'.length + 1);
    expect(problem.message).toContain(FILE);
    expect(problem.message).toContain("line 12");
    expect(problem.message).toContain("comma is missing");
    expect(problem.message).toContain("default settings");
  });

  it("never quotes text from the file", () => {
    const problem = describeJsoncError(FILE, MISSING_COMMA, false);
    const text = JSON.stringify(problem);
    for (const fragment of ["secret-looking", "private.example", "trailing note", "openai-chat"]) {
      expect(text).not.toContain(fragment);
    }
  });

  it("says a reload keeps the last good settings", () => {
    const problem = describeJsoncError(FILE, '{ "a": 1 "b": 2 }', true);
    expect(problem.line).toBe(1);
    expect(problem.message).toContain("last settings");
  });

  it("reports a file it could not open without a line", () => {
    const problem = describeJsoncError(FILE, undefined, false);
    expect(problem.line).toBeUndefined();
    expect(problem.message).toContain(FILE);
  });
});

describe("buildTolerant", () => {
  const build = (config: Record<string, unknown>) => {
    const days = config.autoCleanupRetentionDays ?? 30;
    if (typeof days !== "number" || !Number.isSafeInteger(days) || days <= 0) {
      throw new ConfigValueError("autoCleanupRetentionDays", "whole numbers of 1 or more");
    }
    return { days, memoryModel: config.memoryModel };
  };

  it("keeps the valid model, uses the default days and records one problem with key and range", () => {
    const result = buildTolerant(
      build,
      { autoCleanupRetentionDays: 0, memoryModel: "a-model" },
      () => FILE
    );
    expect(result.config).toEqual({ days: 30, memoryModel: "a-model" });
    expect(result.problems).toHaveLength(1);
    const [problem] = result.problems;
    expect(problem!.kind).toBe("value");
    expect(problem!.key).toBe("autoCleanupRetentionDays");
    expect(problem!.file).toBe(FILE);
    expect(problem!.message).toContain("autoCleanupRetentionDays");
    expect(problem!.message).toContain("whole numbers of 1 or more");
    expect(problem!.message).not.toContain(" 0 ");
    // A rejected days value also turns deletion off for the load (fail-safe key).
    expect(result.fileConfig).toEqual({ memoryModel: "a-model", autoDeleteOldMemories: false });
  });

  it("drops a key named by a plain 'Invalid <key> config' error from another validator", () => {
    const result = buildTolerant(
      (config: Record<string, unknown>) => {
        if (config.keywordMode !== undefined) throw new Error("Invalid keywordMode config");
        return { ok: true };
      },
      { keywordMode: "fusion" },
      () => undefined
    );
    expect(result.config).toEqual({ ok: true });
    expect(result.problems.map((p) => p.key)).toEqual(["keywordMode"]);
    expect(JSON.stringify(result.problems)).not.toContain("fusion");
  });

  it("finds the key behind an error that names none, without quoting the error", () => {
    const result = buildTolerant(
      (config: Record<string, unknown>) => {
        if (config.webServerApiToken) throw new Error("Secret file not found: /private/key");
        return { model: config.memoryModel };
      },
      { memoryModel: "m", webServerApiToken: "file:///private/key" },
      () => FILE
    );
    expect(result.config).toEqual({ model: "m" });
    expect(result.problems.map((p) => p.key)).toEqual(["webServerApiToken"]);
    expect(JSON.stringify(result.problems)).not.toContain("/private/key");
  });

  it("never drops the web app password to get past an error", () => {
    const build = (config: Record<string, unknown>) => {
      if (config.webServerAuthPassword) throw new Error("Environment variable not found: X");
      return {};
    };
    expect(() => buildTolerant(build, { webServerAuthPassword: "env://X" }, () => FILE)).toThrow(
      "Environment variable not found"
    );
  });

  it("rethrows an error that no key explains", () => {
    expect(() =>
      buildTolerant(
        () => {
          throw new Error("something else");
        },
        {},
        () => undefined
      )
    ).toThrow("something else");
  });
});

describe("problem list", () => {
  afterEach(() => recordConfigProblems([]));

  it("replaces the list on each load, so a good load clears it", () => {
    recordConfigProblems([describeJsoncError(FILE, "{ x", false)]);
    expect(currentConfigProblems()).toHaveLength(1);
    recordConfigProblems([]);
    expect(currentConfigProblems()).toEqual([]);
  });
});

// Load paths run in child processes: config.js reads HOME and the files at import.
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const configUrl = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;
const problemsUrl = pathToFileURL(join(import.meta.dir, "../src/services/config-problems.js")).href;

async function loadScenario(
  files: { global?: string; project?: string },
  body: string
): Promise<any> {
  const home = mkdtempSync(join(tmpdir(), "omms-problems-home-"));
  const project = mkdtempSync(join(tmpdir(), "omms-problems-project-"));
  tempDirs.push(home, project);
  const globalPath = join(home, ".config", "omms", "omms.jsonc");
  if (files.global !== undefined) {
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(globalPath, files.global);
  }
  if (files.project !== undefined) {
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(join(project, ".opencode", "omms.jsonc"), files.project);
  }
  const script = `
const { writeFileSync } = await import("node:fs");
const project = ${JSON.stringify(project)};
const globalPath = ${JSON.stringify(globalPath)};
try {
  const cfg = await import(${JSON.stringify(configUrl)});
  const problems = await import(${JSON.stringify(problemsUrl)});
  const result = await (async () => { ${body} })();
  console.log("PROBLEMS_RESULT:" + JSON.stringify({ ok: true, ...result }));
} catch (error) {
  console.log("PROBLEMS_RESULT:" + JSON.stringify({ ok: false, error: String(error) }));
}
`;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const proc = Bun.spawn(["bun", "run", scriptPath], { cwd: home, env, stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const match = text.match(/PROBLEMS_RESULT:(.*)$/m);
  if (!match) throw new Error(`scenario produced no result:\n${text}`);
  return JSON.parse(match[1]!);
}

describe("config load paths keep the host running", () => {
  it("normal load: a broken file loads defaults and records the line", async () => {
    const result = await loadScenario(
      { global: '{\n  "maxMemories": 4\n  "memoryModel": "m"\n}\n' },
      `return { maxMemories: cfg.CONFIG.maxMemories, problems: problems.currentConfigProblems() };`
    );
    expect(result.ok).toBe(true);
    expect(result.maxMemories).toBe(10);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({ kind: "parse", line: 2 });
  });

  it("normal load: an out-of-range value uses its default and keeps the other keys", async () => {
    const result = await loadScenario(
      { global: JSON.stringify({ maxMemories: 0, memoryModel: "kept-model" }) },
      `return { maxMemories: cfg.CONFIG.maxMemories, memoryModel: cfg.CONFIG.memoryModel,
        problems: problems.currentConfigProblems() };`
    );
    expect(result).toMatchObject({ ok: true, maxMemories: 10, memoryModel: "kept-model" });
    expect(result.problems.map((p: { key: string }) => p.key)).toEqual(["maxMemories"]);
    expect(result.problems[0].message).toContain("positive safe integers");
  });

  it("normal load: autoCleanupRetentionDays 0 uses 30 and names the range", async () => {
    const result = await loadScenario(
      { global: JSON.stringify({ autoCleanupRetentionDays: 0 }) },
      `cfg.initConfig(project);
      return { days: cfg.CONFIG.autoCleanupRetentionDays, problems: problems.currentConfigProblems() };`
    );
    expect(result).toMatchObject({ ok: true, days: 30 });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toContain("whole numbers of 1 or more");
  });

  it("project merge: an out-of-range project value uses the default and names the project file", async () => {
    const result = await loadScenario(
      {
        global: JSON.stringify({ maxMemories: 4 }),
        project: JSON.stringify({ retrievalMaxTokens: 1 }),
      },
      `cfg.initConfig(project);
      return { maxMemories: cfg.CONFIG.maxMemories, budget: cfg.CONFIG.retrievalMaxTokens,
        problems: problems.currentConfigProblems() };`
    );
    expect(result).toMatchObject({ ok: true, maxMemories: 4, budget: 2000 });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].key).toBe("retrievalMaxTokens");
    expect(result.problems[0].file).toContain(".opencode");
  });

  it("project merge: a broken project file keeps the global settings and records its line", async () => {
    const result = await loadScenario(
      { global: JSON.stringify({ maxMemories: 4 }), project: "{\n\n  x\n}" },
      `cfg.initConfig(project);
      return { maxMemories: cfg.CONFIG.maxMemories, problems: problems.currentConfigProblems() };`
    );
    expect(result).toMatchObject({ ok: true, maxMemories: 4 });
    expect(result.problems[0]).toMatchObject({ kind: "parse", line: 3 });
  });

  it("reload: a broken edit keeps the last good settings; a rejected value uses its default; a fix clears both", async () => {
    const result = await loadScenario(
      { global: JSON.stringify({ maxMemories: 4 }) },
      `cfg.initConfig(project);
      writeFileSync(globalPath, '{ "maxMemories": 6\\n "x": 1 }');
      cfg.refreshConfigIfChanged(project);
      const broken = { maxMemories: cfg.CONFIG.maxMemories, problems: problems.currentConfigProblems() };
      writeFileSync(globalPath, JSON.stringify({ maxMemories: 0, memoryModel: "m2" }));
      cfg.refreshConfigIfChanged(project);
      const invalid = { maxMemories: cfg.CONFIG.maxMemories, problems: problems.currentConfigProblems() };
      writeFileSync(globalPath, JSON.stringify({ maxMemories: 7 }));
      cfg.refreshConfigIfChanged(project);
      return { broken, invalid, fixed: { maxMemories: cfg.CONFIG.maxMemories,
        problems: problems.currentConfigProblems() } };`
    );
    expect(result.ok).toBe(true);
    expect(result.broken.maxMemories).toBe(4);
    expect(result.broken.problems).toHaveLength(1);
    expect(result.broken.problems[0]).toMatchObject({ kind: "parse", line: 1 });
    expect(result.broken.problems[0].message).toContain("last settings");
    // A rejected value no longer stops the reload: the other edits apply (friendly-settings).
    expect(result.invalid.maxMemories).toBe(10);
    expect(result.invalid.problems.map((p: { key: string }) => p.key)).toEqual(["maxMemories"]);
    expect(result.fixed).toEqual({ maxMemories: 7, problems: [] });
  });
});

describe("read-only settings snapshot", () => {
  it("shows the last good settings the host still uses, never a wrong default", async () => {
    const snapshotUrl = pathToFileURL(
      join(import.meta.dir, "../src/services/settings-snapshot.js")
    ).href;
    const result = await loadScenario(
      { global: JSON.stringify({ chatMessage: { enabled: false }, visibleRecall: false }) },
      `cfg.initConfig(project);
      writeFileSync(globalPath, '{ "visibleRecall": false\\n "x": 1 }');
      cfg.refreshConfigIfChanged(project);
      const { getSettingsSnapshot } = await import(${JSON.stringify(snapshotUrl)});
      const snap = getSettingsSnapshot(project);
      return { readOnly: snap.readOnly, valuesFrom: snap.valuesFrom,
        recall: snap.settings["chatMessage.enabled"], rows: snap.settings.visibleRecall,
        capture: snap.settings.autoCaptureEnabled };`
    );
    expect(result.ok).toBe(true);
    expect(result.readOnly).toBe(true);
    expect(result.valuesFrom).toBe("last-good");
    expect(result.recall).toMatchObject({ value: false, globalValue: false, source: "global" });
    expect(result.rows).toMatchObject({ value: false, source: "global" });
    // A key the last good file did not set is the default, and says so truthfully.
    expect(result.capture.source).toBe("default");
  });
});

function tempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omms-problems-file-"));
  tempDirs.push(dir);
  const file = join(dir, "omms.jsonc");
  writeFileSync(file, content);
  return file;
}

describe("fail-safe keys: a rejected value turns the feature off", () => {
  const build = (config: Record<string, unknown>) => {
    const days = config.autoCleanupRetentionDays ?? 30;
    if (typeof days !== "number" || days <= 0) {
      throw new ConfigValueError("autoCleanupRetentionDays", "whole numbers of 1 or more");
    }
    if (config.autoBackfill !== undefined && typeof config.autoBackfill !== "boolean") {
      throw new Error("Invalid autoBackfill config");
    }
    return {
      deleteOld: config.autoDeleteOldMemories === true,
      days,
      autoBackfill: config.autoBackfill ?? true,
    };
  };

  it("a rejected days value turns deletion off and says so", () => {
    const file = tempFile(
      '{\n  "autoDeleteOldMemories": true,\n  "autoCleanupRetentionDays": "365"\n}\n'
    );
    const result = buildTolerant(
      build,
      { autoDeleteOldMemories: true, autoCleanupRetentionDays: "365" },
      () => file
    );
    expect(result.config).toEqual({ deleteOld: false, days: 30, autoBackfill: true });
    const [problem] = result.problems;
    expect(problem!.off).toBe("autoDeleteOldMemories");
    expect(problem!.line).toBe(3);
    expect(problem!.message).toContain("Automatic memory deletion is off");
    expect(problem!.message).not.toContain("uses the default");
  });

  it("autoBackfill written as text is off, not the default on", () => {
    const result = buildTolerant(build, { autoBackfill: "false" }, () => FILE);
    expect(result.config.autoBackfill).toBe(false);
    expect(result.problems[0]!.off).toBe("autoBackfill");
  });

  it("a key the Settings page cannot edit says to fix the file and names the line", () => {
    const result = buildTolerant(
      (config: Record<string, unknown>) => {
        if (config.keywordBoost !== undefined) throw new Error("Invalid keywordBoost config");
        return {};
      },
      { keywordBoost: 9 },
      () => tempFile('{\n  "a": 1,\n\n  "keywordBoost": 9\n}\n')
    );
    const [problem] = result.problems;
    expect(problem!.message).toContain("line 4");
    expect(problem!.message).toContain("Fix the file.");
    expect(problem!.message).not.toContain("Settings page");
  });

  it("a key the Settings page edits still points to the page", () => {
    const result = buildTolerant(build, { autoCleanupRetentionDays: 0 }, () => FILE);
    expect(result.problems[0]!.message).toContain("Settings page");
  });
});

describe("config load paths fail safe", () => {
  const read = `return { del: cfg.CONFIG.autoDeleteOldMemories, days: cfg.CONFIG.autoCleanupRetentionDays,
    backfill: cfg.CONFIG.autoBackfill, autoStart: cfg.CONFIG.webServerAutoStart,
    tidy: cfg.CONFIG.userProfileAutoCleanupEnabled, model: cfg.CONFIG.memoryModel,
    problems: problems.currentConfigProblems() };`;

  it("days written as text: deletion is off for the load, and the problem says so", async () => {
    const result = await loadScenario(
      { global: '{\n  "autoDeleteOldMemories": true,\n  "autoCleanupRetentionDays": "365"\n}\n' },
      `cfg.initConfig(project); ${read}`
    );
    expect(result).toMatchObject({ ok: true, del: false, days: 30 });
    expect(result.problems[0]).toMatchObject({
      key: "autoCleanupRetentionDays",
      off: "autoDeleteOldMemories",
      line: 3,
    });
    expect(result.problems[0].message).toContain("Automatic memory deletion is off");
  });

  it("autoDeleteOldMemories that is not a real boolean is off, with a problem", async () => {
    const result = await loadScenario(
      { global: JSON.stringify({ autoDeleteOldMemories: "true" }) },
      `cfg.initConfig(project); ${read}`
    );
    expect(result).toMatchObject({ ok: true, del: false });
    expect(result.problems.map((p: { key: string }) => p.key)).toEqual(["autoDeleteOldMemories"]);
  });

  it("autoBackfill, webServerAutoStart and a bad backfill model or profile interval turn off", async () => {
    const result = await loadScenario(
      {
        global: JSON.stringify({
          autoBackfill: "false",
          webServerAutoStart: "no",
          userProfileAutoCleanupEnabled: true,
          userProfileAutoCleanupInterval: "1000",
        }),
      },
      `cfg.initConfig(project); ${read}`
    );
    expect(result).toMatchObject({ ok: true, backfill: false, autoStart: false, tidy: false });
    const model = await loadScenario(
      { global: JSON.stringify({ piBackfillModel: "no-slash" }) },
      `cfg.initConfig(project); ${read}`
    );
    expect(model).toMatchObject({ ok: true, backfill: false });
    expect(model.problems[0]).toMatchObject({ key: "piBackfillModel", off: "autoBackfill" });
  });

  it("reload with a rejected value picks up the other edits and keeps deletion off", async () => {
    const result = await loadScenario(
      { global: JSON.stringify({ autoDeleteOldMemories: true }) },
      `cfg.initConfig(project);
      const before = cfg.CONFIG.autoDeleteOldMemories;
      writeFileSync(globalPath, JSON.stringify({ autoDeleteOldMemories: true,
        autoCleanupRetentionDays: "365", memoryModel: "new-model" }));
      cfg.refreshConfigIfChanged(project);
      return { before, ...(${read.replace(/^return /, "").replace(/;$/, "")}) };`
    );
    expect(result).toMatchObject({ ok: true, before: true, del: false, model: "new-model" });
    expect(result.problems[0].off).toBe("autoDeleteOldMemories");
  });
});
