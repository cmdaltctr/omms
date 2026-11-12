import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

async function scenario(body: string, seed = "{}\n") {
  const home = mkdtempSync(join(tmpdir(), "omms-memorisation-settings-"));
  homes.push(home);
  const target = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, seed);
  const config = pathToFileURL(join(import.meta.dir, "../src/config.ts")).href;
  const writer = pathToFileURL(
    join(import.meta.dir, "../src/services/global-config-writer.ts")
  ).href;
  const snapshot = pathToFileURL(
    join(import.meta.dir, "../src/services/settings-snapshot.ts")
  ).href;
  const project = join(home, "project");
  const script = `
    const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
    const cfg = await import(${JSON.stringify(config)});
    const { writeGlobalConfigKeys, readGlobalConfigRevision } = await import(${JSON.stringify(writer)});
    const { getSettingsSnapshot } = await import(${JSON.stringify(snapshot)});
    const target = ${JSON.stringify(target)};
    const project = ${JSON.stringify(project)};
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

describe("memorisation settings", () => {
  it("uses the shared defaults and documents the keys and ranges in the template", async () => {
    const result = await scenario(`
      return {
        repeat: cfg.CONFIG.memorisationRepeat,
        maxSize: cfg.CONFIG.memorisationMaxSize,
        unit: cfg.CONFIG.memorisationSizeUnit,
        template: cfg.CONFIG_TEMPLATE,
      };
    `);
    expect(result.repeat).toBe("add");
    expect(result.maxSize).toBe(2000);
    expect(result.unit).toBe("characters");
    for (const key of ["memorisationRepeat", "memorisationMaxSize", "memorisationSizeUnit"]) {
      expect(result.template).toContain(`// "${key}"`);
    }
    expect(result.template).toContain("100 to 20,000 characters");
    expect(result.template).toContain("25 to 5,000 tokens");
  });

  it("validates configured settings and ignores all three project overrides", async () => {
    const result = await scenario(`
      mkdirSync(project + "/.opencode", { recursive: true });
      writeFileSync(project + "/.opencode/omms.jsonc", JSON.stringify({
        memorisationRepeat: "replace",
        memorisationMaxSize: 500,
        memorisationSizeUnit: "tokens",
      }));
      cfg.initConfig(project);
      const overrides = {
        repeat: cfg.CONFIG.memorisationRepeat,
        maxSize: cfg.CONFIG.memorisationMaxSize,
        unit: cfg.CONFIG.memorisationSizeUnit,
      };
      const errors = [];
      for (const value of [
        { memorisationRepeat: "append" },
        { memorisationMaxSize: 50 },
        { memorisationMaxSize: 500, memorisationSizeUnit: "bytes" },
      ]) {
        try { cfg.validateGlobalConfig(value); } catch (error) { errors.push(error.message); }
      }
      return { overrides, errors };
    `);
    expect(result.overrides).toEqual({ repeat: "add", maxSize: 2000, unit: "characters" });
    expect(result.errors).toHaveLength(3);
  });

  it("writes and snapshots valid settings from the global file", async () => {
    const result = await scenario(`
      await writeGlobalConfigKeys({
        memorisationRepeat: "replace",
        memorisationMaxSize: 500,
        memorisationSizeUnit: "tokens",
      }, readGlobalConfigRevision());
      mkdirSync(project + "/.opencode", { recursive: true });
      writeFileSync(project + "/.opencode/omms.jsonc", JSON.stringify({
        memorisationRepeat: "add",
        memorisationMaxSize: 50,
        memorisationSizeUnit: "characters",
      }));
      return {
        text: readFileSync(target, "utf8"),
        settings: getSettingsSnapshot(project).settings,
      };
    `);
    expect(result.text).toContain('"memorisationRepeat": "replace"');
    expect(result.text).toContain('"memorisationMaxSize": 500');
    expect(result.text).toContain('"memorisationSizeUnit": "tokens"');
    expect(result.settings.memorisationRepeat).toMatchObject({
      value: "replace",
      globalValue: "replace",
      source: "global",
    });
    expect(result.settings.memorisationMaxSize).toMatchObject({
      value: 500,
      globalValue: 500,
      source: "global",
    });
    expect(result.settings.memorisationSizeUnit).toMatchObject({
      value: "tokens",
      globalValue: "tokens",
      source: "global",
    });
  });

  it("accepts a unit-only edit when the existing size is valid", async () => {
    const result = await scenario(`
      await writeGlobalConfigKeys({ memorisationSizeUnit: "tokens" }, readGlobalConfigRevision());
      return { text: readFileSync(target, "utf8") };
    `);
    expect(result.text).toContain('"memorisationSizeUnit": "tokens"');
  });

  it("refuses invalid sizes and repeat values without changing the file", async () => {
    const seed = '{\n  "memorisationRepeat": "replace",\n  "memorisationMaxSize": 2000\n}\n';
    const result = await scenario(
      `
      const errors = [];
      for (const edits of [
        { memorisationMaxSize: 50 },
        { memorisationMaxSize: 20001 },
        { memorisationMaxSize: 10, memorisationSizeUnit: "tokens" },
        { memorisationMaxSize: 5001, memorisationSizeUnit: "tokens" },
        { memorisationMaxSize: 500.5 },
        { memorisationSizeUnit: "bytes" },
        { memorisationRepeat: "append" },
      ]) {
        try { await writeGlobalConfigKeys(edits, readGlobalConfigRevision()); }
        catch (error) { errors.push(error.message); }
      }
      return { errors, text: readFileSync(target, "utf8") };
    `,
      seed
    );
    expect(result.errors).toEqual([
      "memorisationMaxSize must be a whole number from 100 to 20000 characters",
      "memorisationMaxSize must be a whole number from 100 to 20000 characters",
      "memorisationMaxSize must be a whole number from 25 to 5000 tokens",
      "memorisationMaxSize must be a whole number from 25 to 5000 tokens",
      "memorisationMaxSize must be a whole number from 100 to 20000 characters",
      "Invalid memorisationSizeUnit setting",
      "memorisationRepeat must be add or replace",
    ]);
    expect(result.text).toBe(seed);
  });

  it("refuses a unit switch when the existing global size is invalid for it", async () => {
    const seed = '{\n  "memorisationMaxSize": 10000,\n  "memorisationSizeUnit": "characters"\n}\n';
    const result = await scenario(
      `
      let error = "";
      try {
        await writeGlobalConfigKeys({ memorisationSizeUnit: "tokens" }, readGlobalConfigRevision());
      } catch (caught) { error = caught.message; }
      return { error, text: readFileSync(target, "utf8") };
    `,
      seed
    );
    expect(result.error).toBe("memorisationMaxSize must be a whole number from 25 to 5000 tokens");
    expect(result.text).toBe(seed);
  });

  it("defaults memorisationRerank to false, validates booleans, and documents the key", async () => {
    const result = await scenario(`
      cfg.initConfig(project);
      return { value: cfg.CONFIG.memorisationRerank, template: cfg.CONFIG_TEMPLATE };
    `);
    expect(result.value).toBe(false);
    expect(result.template).toContain('// "memorisationRerank"');
    const checked = await scenario(`
      const errors = [];
      for (const value of [true, false]) {
        try { cfg.validateGlobalConfig({ memorisationRerank: value }); } catch (error) { errors.push(String(error)); }
      }
      for (const value of ["yes", 1, null]) {
        try { cfg.validateGlobalConfig({ memorisationRerank: value }); errors.push("accepted " + JSON.stringify(value)); }
        catch (error) { if (!String(error).includes("memorisationRerank")) errors.push(String(error)); }
      }
      return { errors };
    `);
    expect(checked.errors).toEqual([]);
    const seeded = await scenario(
      `
      writeFileSync(target, '{ "memorisationRerank": "yes" }');
      let error = "";
      try { cfg.initConfig(project); } catch (caught) { error = String(caught); }
      return { error };
    `
    );
    expect(seeded.error).toContain("memorisationRerank");
  });

  it("writes and snapshots memorisationRerank, and refuses non-boolean edits", async () => {
    const result = await scenario(`
      await writeGlobalConfigKeys({ memorisationRerank: true }, readGlobalConfigRevision());
      const errors = [];
      for (const value of ["yes", 1, null]) {
        try { await writeGlobalConfigKeys({ memorisationRerank: value }, readGlobalConfigRevision()); }
        catch (error) { errors.push(error.message); }
      }
      return { text: readFileSync(target, "utf8"), errors, snapshot: getSettingsSnapshot(project).settings };
    `);
    expect(result.text).toContain('"memorisationRerank": true');
    expect(result.errors).toHaveLength(3);
    for (const error of result.errors) expect(error).toContain("memorisationRerank");
    expect(result.snapshot.memorisationRerank).toMatchObject({
      value: true,
      globalValue: true,
      source: "global",
    });
  });

  it("ignores a project config memorisationRerank and unknown keys at load", async () => {
    const result = await scenario(
      `
      mkdirSync(project + "/.opencode", { recursive: true });
      writeFileSync(project + "/.opencode/omms.jsonc", JSON.stringify({ memorisationRerank: false }));
      cfg.initConfig(project);
      return { value: cfg.CONFIG.memorisationRerank };
    `,
      '{ "memorisationRerank": true, "aFutureKeyNeitherVersionKnows": 1 }\n'
    );
    // The project file cannot turn it off, and the unknown key does not stop the load.
    expect(result.value).toBe(true);
  });

  it("checks paired edits against the latest queued global file", async () => {
    const result = await scenario(`
      const revision = readGlobalConfigRevision();
      const first = writeGlobalConfigKeys({ memorisationMaxSize: 50 }, revision);
      const second = writeGlobalConfigKeys({ memorisationSizeUnit: "tokens" }, revision);
      const settled = await Promise.allSettled([first, second]);
      return {
        reasons: settled.filter((result) => result.status === "rejected").map((result) => result.reason.message),
        text: readFileSync(target, "utf8"),
      };
    `);
    expect(result.reasons).toEqual([
      "memorisationMaxSize must be a whole number from 100 to 20000 characters",
    ]);
    expect(result.text).toContain('"memorisationSizeUnit": "tokens"');
    expect(result.text).not.toContain('"memorisationMaxSize"');
  });
});
