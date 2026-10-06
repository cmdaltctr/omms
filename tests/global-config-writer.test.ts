import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

async function scenario(body: string, seed?: string, legacy = false) {
  const home = mkdtempSync(join(tmpdir(), "omms-settings-"));
  homes.push(home);
  const target = join(
    home,
    ".config",
    legacy ? "opencode" : "omms",
    legacy ? "opencode-mem.jsonc" : "omms.jsonc"
  );
  if (seed !== undefined) {
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, seed);
  }
  const config = pathToFileURL(join(import.meta.dir, "../src/config.ts")).href;
  const writer = pathToFileURL(
    join(import.meta.dir, "../src/services/global-config-writer.ts")
  ).href;
  const script = `
    const { readFileSync, existsSync, writeFileSync } = await import("node:fs");
    const cfg = await import(${JSON.stringify(config)});
    const { writeGlobalConfigKeys, readGlobalConfigRevision } = await import(${JSON.stringify(writer)});
    const target = ${JSON.stringify(target)};
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

describe("global config writer", () => {
  it("saves each automatic setting and exposes its global snapshot", async () => {
    const result = await scenario(
      `
      const { getSettingsSnapshot } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/settings-snapshot.ts")).href)});
      await writeGlobalConfigKeys({ autoBackfill: false, webServerAutoStart: false,
        piBackfillModel: "zai/glm-5-turbo", opencodeBackfillModel: "a/b/c" },
        readGlobalConfigRevision());
      return { text: readFileSync(target, "utf8"), settings: getSettingsSnapshot(${JSON.stringify(import.meta.dir)}).settings };
    `,
      "{}\n"
    );
    expect(result.text).toContain('"autoBackfill": false');
    expect(result.text).toContain('"webServerAutoStart": false');
    expect(result.settings.piBackfillModel.globalValue).toBe("zai/glm-5-turbo");
    expect(result.settings.opencodeBackfillModel.globalValue).toBe("a/b/c");
    expect(result.settings.autoBackfill.globalValue).toBe(false);
    expect(result.settings.webServerAutoStart.globalValue).toBe(false);
  });
  it("keeps comments, order, and unrelated values", async () => {
    const seed =
      '{\n  // owner\n  "maxMemories": 12,\n  "piModel": "old",\n  "memoryModel": "secret-model"\n}\n';
    const result = await scenario(
      `
      const revision = readGlobalConfigRevision();
      await writeGlobalConfigKeys({ piModel: "new" }, revision);
      return { text: readFileSync(target, "utf8") };
    `,
      seed
    );
    expect(result.text).toContain("// owner");
    expect(result.text).toContain('"maxMemories": 12');
    expect(result.text).toContain('"memoryModel": "secret-model"');
    expect(result.text.indexOf("maxMemories")).toBeLessThan(result.text.indexOf("piModel"));
    expect(result.text).toContain('"piModel": "new"');
  });
  it("rejects unknown keys and invalid values without changing the file", async () => {
    const seed = '{ "piModel": "old" }\n';
    const result = await scenario(
      `
      const errors = [];
      for (const edits of [{ memoryApiKey: "leak" }, { captureAttemptRetentionDays: 0 }]) {
        try { await writeGlobalConfigKeys(edits, readGlobalConfigRevision()); }
        catch (error) { errors.push(String(error)); }
      }
      return { errors, text: readFileSync(target, "utf8") };
    `,
      seed
    );
    expect(result.errors).toHaveLength(2);
    expect(result.text).toBe(seed);
  });

  it("saves claudeConfigDir globally, clears it with an empty value, and reports the folder", async () => {
    const seed = '{ "piModel": "old" }\n';
    const result = await scenario(
      `
      delete process.env.CLAUDE_CONFIG_DIR;
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const home = join(target, "..", "..", "..");
      const errors = [];
      for (const edits of [{ claudeConfigDir: "claude/config" }, { claudeConfigDir: 3 }]) {
        try { await writeGlobalConfigKeys(edits, readGlobalConfigRevision()); }
        catch (error) { errors.push(String(error)); }
      }
      const untouched = readFileSync(target, "utf8");
      const custom = join(home, "custom-claude");
      await writeGlobalConfigKeys({ claudeConfigDir: custom }, readGlobalConfigRevision());
      const project = join(home, "project");
      mkdirSync(join(project, ".opencode"), { recursive: true });
      writeFileSync(join(project, ".opencode", "omms.jsonc"), '{ "claudeConfigDir": "/evil" }');
      const { getSettingsSnapshot } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/settings-snapshot.ts")).href)});
      const saved = getSettingsSnapshot(project);
      const missing = saved.claudeFolder;
      mkdirSync(join(custom, "projects"), { recursive: true });
      const found = getSettingsSnapshot(project).claudeFolder;
      await writeGlobalConfigKeys({ claudeConfigDir: "~/tilde-claude" }, readGlobalConfigRevision());
      const tilde = getSettingsSnapshot(project).claudeFolder;
      await writeGlobalConfigKeys({ claudeConfigDir: "" }, readGlobalConfigRevision());
      const cleared = getSettingsSnapshot(project).claudeFolder;
      process.env.CLAUDE_CONFIG_DIR = join(home, "env-claude");
      const fromEnv = getSettingsSnapshot(project).claudeFolder;
      return { errors, untouched, custom, home, setting: saved.settings.claudeConfigDir,
        missing, found, tilde, cleared, fromEnv, text: readFileSync(target, "utf8") };
    `,
      seed
    );
    expect(result.errors).toHaveLength(2);
    expect(result.untouched).toBe(seed);
    expect(result.setting).toMatchObject({ value: result.custom, source: "global" });
    expect(result.missing).toEqual({
      root: join(result.custom, "projects"),
      source: "setting",
      exists: false,
    });
    expect(result.found.exists).toBe(true);
    expect(result.tilde).toMatchObject({
      root: join(result.home, "tilde-claude", "projects"),
      source: "setting",
    });
    expect(result.cleared).toMatchObject({
      root: join(result.home, ".claude", "projects"),
      source: "default",
    });
    expect(result.fromEnv).toMatchObject({
      root: join(result.home, "env-claude", "projects"),
      source: "env",
    });
    expect(result.text).toContain('"claudeConfigDir": ""');
  });

  it("saves capture retry retention in whole hours from 0 to 720", async () => {
    const seed = '{ "piModel": "old" }\n';
    const result = await scenario(
      `
      const errors = [];
      for (const edits of [
        { captureRetryRetentionHours: -1 },
        { captureRetryRetentionHours: 721 },
        { captureRetryRetentionHours: 1.5 },
        { captureRetryRetentionHours: "24" },
      ]) {
        try { await writeGlobalConfigKeys(edits, readGlobalConfigRevision()); }
        catch (error) { errors.push(String(error)); }
      }
      await writeGlobalConfigKeys({ captureRetryRetentionHours: 0 }, readGlobalConfigRevision());
      // A project value is ignored: the page shows the global value.
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const project = join(target, "..", "..", "..", "project");
      mkdirSync(join(project, ".opencode"), { recursive: true });
      writeFileSync(join(project, ".opencode", "omms.jsonc"), '{ "captureRetryRetentionHours": 720 }');
      const { getSettingsSnapshot } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/settings-snapshot.ts")).href)});
      return {
        errors,
        text: readFileSync(target, "utf8"),
        setting: getSettingsSnapshot(project).settings.captureRetryRetentionHours,
      };
    `,
      seed
    );
    expect(result.errors).toHaveLength(4);
    expect(result.text).toContain('"captureRetryRetentionHours": 0');
    expect(result.setting).toMatchObject({ value: 0, source: "global", globalValue: 0 });
  });

  it("saves external API settings, maps, and ignored directories, and refuses a literal key without writing", async () => {
    const seed = '{\n  // keep me\n  "piModel": "a"\n}\n';
    const result = await scenario(
      `
      const saved = await writeGlobalConfigKeys({
        memoryProvider: "openai-chat",
        memoryApiUrl: "https://api.example.invalid/v1",
        memoryModel: "glm-5-turbo",
        memoryApiKey: "env://ZAI_API_KEY",
        importPathMaps: [{ from: "/old", to: "/new" }],
        importIgnoredDirectories: ["/private/tmp/scratch"],
      }, readGlobalConfigRevision());
      const afterSave = readFileSync(target, "utf8");
      const ignored = [];
      for (const value of ["/tmp/x", ["relative/dir"]]) {
        try {
          await writeGlobalConfigKeys({ importIgnoredDirectories: value }, saved.revision);
        } catch (error) { ignored.push(error.message); }
      }
      let literal = "";
      try {
        await writeGlobalConfigKeys({ memoryApiKey: "sk-literal-secret" }, saved.revision);
      } catch (error) { literal = error.message; }
      let provider = "";
      try {
        await writeGlobalConfigKeys({ memoryProvider: "nope" }, saved.revision);
      } catch (error) { provider = error.message; }
      return { afterSave, unchanged: readFileSync(target, "utf8") === afterSave, literal, provider, ignored };
    `,
      seed
    );
    expect(result.afterSave).toContain("// keep me");
    expect(result.afterSave).toContain('"memoryApiKey": "env://ZAI_API_KEY"');
    expect(result.afterSave).toContain('"from": "/old"');
    expect(result.afterSave).toContain('"importIgnoredDirectories": [');
    expect(result.afterSave).toContain('"/private/tmp/scratch"');
    expect(result.ignored).toEqual([
      "Invalid importIgnoredDirectories setting",
      "Invalid importIgnoredDirectories config: entry 0 needs an absolute path",
    ]);
    expect(result.unchanged).toBe(true);
    expect(result.literal).toBe("memoryApiKey must be an env:// or file:// reference");
    expect(result.literal).not.toContain("sk-literal-secret");
    expect(result.provider).toBe("Invalid memoryProvider setting");
  });

  it("creates a missing config from the template", async () => {
    const result = await scenario(`
      await writeGlobalConfigKeys({ piModel: "test" }, readGlobalConfigRevision());
      const path = cfg.getGlobalConfigWritePath();
      return { text: readFileSync(path, "utf8") };
    `);
    expect(result.text).toContain("Configuration");
    expect(result.text).toContain('"piModel": "test"');
  });
  it("serialises simultaneous saves and rejects a stale page revision", async () => {
    const result = await scenario(
      `
      const revision = readGlobalConfigRevision();
      await Promise.all([
        writeGlobalConfigKeys({ piModel: "one" }, revision),
        writeGlobalConfigKeys({ opencodeModel: "two" }, revision),
      ]);
      let status;
      try { await writeGlobalConfigKeys({ piModel: "stale" }, revision); }
      catch (error) { status = error.status; }
      return { text: readFileSync(target, "utf8"), status };
    `,
      "{}\n"
    );
    expect(result.text).toContain('"piModel": "one"');
    expect(result.text).toContain('"opencodeModel": "two"');
    expect(result.status).toBe(409);
  });

  it("rejects a hand edit made after the page read the file", async () => {
    const result = await scenario(
      `
      const revision = readGlobalConfigRevision();
      writeFileSync(target, '{ "piModel": "hand edit" }\\n');
      let status;
      try { await writeGlobalConfigKeys({ piModel: "page edit" }, revision); }
      catch (error) { status = error.status; }
      return { text: readFileSync(target, "utf8"), status };
    `,
      "{}\n"
    );
    expect(result.status).toBe(409);
    expect(result.text).toContain("hand edit");
  });

  it("copies legacy content on first edit without writing the legacy file", async () => {
    const seed = '{\n  // legacy\n  "memoryModel": "keep",\n  "piModel": "old"\n}\n';
    const result = await scenario(
      `
      const response = await writeGlobalConfigKeys({ piModel: "new" }, readGlobalConfigRevision());
      const path = cfg.getGlobalConfigWritePath();
      return { response, legacy: readFileSync(target, "utf8"), text: readFileSync(path, "utf8") };
    `,
      seed,
      true
    );
    expect(result.legacy).toBe(seed);
    expect(result.text).toContain("// legacy");
    expect(result.text).toContain('"memoryModel": "keep"');
    expect(result.text).toContain('"piModel": "new"');
    expect(result.response.migratedLegacy).toBe(true);
  });
});
