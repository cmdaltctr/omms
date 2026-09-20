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

/**
 * omms config identity is tested in child processes because config.js runs
 * real filesystem side effects at import (config template, directories) and
 * resolves paths from HOME. Each scenario gets a fresh process with a temp
 * HOME, mirroring a first run on a user machine.
 */
function runConfigScenario(home: string, body: string): Promise<any> {
  const script = `
const { existsSync, readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
// Namespace access keeps the live CONFIG binding: initConfigWithLegacyMigration
// rebinds the export, and destructuring would capture a stale object.
const cfg = await import(${JSON.stringify(configUrl)});
const initConfig = cfg.initConfig;
const initConfigWithLegacyMigration = cfg.initConfigWithLegacyMigration;

try {
  const result = await (async () => { ${body} })();
  console.log("SCENARIO_RESULT:" + JSON.stringify({ ok: true, ...result, liveStoragePath: cfg.CONFIG.storagePath }));
} catch (error) {
  console.log("SCENARIO_RESULT:" + JSON.stringify({ ok: false, error: String(error) }));
}
`;

  const dir = mkdtempSync(join(tmpdir(), "omms-config-scenario-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script);

  // HOME must be set in the spawn environment: Bun's os.homedir() ignores
  // in-script process.env changes. The migration kill-switch (set by the
  // test preload in this parent process) must not leak into the child.
  const childEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete childEnv.OMMS_SKIP_LEGACY_MIGRATION;
  const proc = Bun.spawn(["bun", "run", scriptPath], { env: childEnv });
  const stdout = new Response(proc.stdout).text();
  return proc.exited.then(async () => {
    const text = await stdout;
    const match = text.match(/SCENARIO_RESULT:(.*)$/m);
    if (!match) throw new Error(`scenario produced no result:\n${text}`);
    return JSON.parse(match[1]);
  });
}

function seedLegacyLayout(home: string): void {
  mkdirSync(join(home, ".opencode-mem", "data"), { recursive: true });
  writeFileSync(join(home, ".opencode-mem", "data", "global.sqlite"), "legacy-store");
}

describe("omms config identity", () => {
  it("fresh installs default to ~/.omms/data with a new-config template and no legacy artefacts", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-config-test-"));
    tempDirs.push(home);

    const result = await runConfigScenario(
      home,
      `
      const ommsData = join(${JSON.stringify(home)}, ".omms", "data");
      const template = join(${JSON.stringify(home)}, ".config", "omms", "omms.jsonc");
      const legacyConfig = join(${JSON.stringify(home)}, ".config", "opencode", "opencode-mem.jsonc");
      initConfigWithLegacyMigration("/tmp/nonexistent-project");
      return {
        storagePath: cfg.CONFIG.storagePath,
        templateCreated: existsSync(template),
        legacyConfigCreated: existsSync(legacyConfig),
        legacyDirCreated: existsSync(join(${JSON.stringify(home)}, ".opencode-mem")),
        migrationMarker: existsSync(join(${JSON.stringify(home)}, ".omms", "migration-marker.json")),
        ommsDataMatch: cfg.CONFIG.storagePath === ommsData,
      };
      `
    );

    expect(result.ok).toBe(true);
    expect(result.ommsDataMatch).toBe(true);
    expect(result.templateCreated).toBe(true);
    expect(result.legacyConfigCreated).toBe(false);
    expect(result.legacyDirCreated).toBe(false);
    expect(result.migrationMarker).toBe(false);
  });

  it("reads the legacy config only when no omms config exists, and never writes it", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-config-test-"));
    tempDirs.push(home);
    const legacyConfig = join(home, ".config", "opencode", "opencode-mem.jsonc");
    const legacyBefore = '{ "opencodeModel": "legacy-model" }\n';
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(legacyConfig, legacyBefore, "utf-8");

    const result = await runConfigScenario(
      home,
      `
      return {
        opencodeModel: cfg.CONFIG.opencodeModel,
        legacyUntouched: readFileSync(${JSON.stringify(legacyConfig)}, "utf-8"),
        newConfigCreated: existsSync(join(${JSON.stringify(home)}, ".config", "omms", "omms.jsonc")),
      };
      `
    );

    expect(result.ok).toBe(true);
    expect(result.opencodeModel).toBe("legacy-model");
    expect(result.legacyUntouched).toBe(legacyBefore);
    expect(result.newConfigCreated).toBe(false);
  });

  it("gives the omms config precedence over the legacy config", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-config-test-"));
    tempDirs.push(home);
    const ommsConfig = join(home, ".config", "omms", "omms.jsonc");
    const legacyConfig = join(home, ".config", "opencode", "opencode-mem.jsonc");
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(ommsConfig, '{ "opencodeModel": "new-model" }', "utf-8");
    writeFileSync(legacyConfig, '{ "opencodeModel": "legacy-model" }', "utf-8");

    const result = await runConfigScenario(
      home,
      `
      return {
        opencodeModel: cfg.CONFIG.opencodeModel,
        legacyContent: readFileSync(${JSON.stringify(legacyConfig)}, "utf-8"),
      };
      `
    );

    expect(result.ok).toBe(true);
    expect(result.opencodeModel).toBe("new-model");
    expect(result.legacyContent).toBe('{ "opencodeModel": "legacy-model" }');
  });

  it("migrates a legacy store on first start and flips the storage default to the omms layout", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-config-test-"));
    tempDirs.push(home);
    seedLegacyLayout(home);

    const result = await runConfigScenario(
      home,
      `
      const legacyData = join(${JSON.stringify(home)}, ".opencode-mem", "data");
      const ommsData = join(${JSON.stringify(home)}, ".omms", "data");
      const beforeInit = cfg.CONFIG.storagePath;
      initConfigWithLegacyMigration("/tmp/nonexistent-project");
      return {
        beforeInit,
        afterInit: cfg.CONFIG.storagePath,
        beforeWasLegacy: beforeInit === legacyData,
        afterIsOmms: cfg.CONFIG.storagePath === ommsData,
        copiedStore: existsSync(join(ommsData, "global.sqlite"))
          ? readFileSync(join(ommsData, "global.sqlite"), "utf-8")
          : null,
        legacyStillThere: existsSync(join(legacyData, "global.sqlite")),
        marker: JSON.parse(readFileSync(join(${JSON.stringify(home)}, ".omms", "migration-marker.json"), "utf-8")),
      };
      `
    );

    expect(result.ok).toBe(true);
    expect(result.beforeWasLegacy).toBe(true);
    expect(result.afterIsOmms).toBe(true);
    expect(result.copiedStore).toBe("legacy-store");
    expect(result.legacyStillThere).toBe(true);
    expect(result.marker.status).toBe("migrated");
  });

  it("keeps resolving storage against the legacy layout when a failed marker is present", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-config-test-"));
    tempDirs.push(home);
    seedLegacyLayout(home);
    mkdirSync(join(home, ".omms"), { recursive: true });
    writeFileSync(
      join(home, ".omms", "migration-marker.json"),
      JSON.stringify({
        version: 1,
        status: "failed",
        stage: "backup",
        source: join(home, ".opencode-mem", "data"),
        destination: join(home, ".omms", "data"),
        startedAt: new Date().toISOString(),
        error: "simulated backup failure",
      }),
      "utf-8"
    );

    const result = await runConfigScenario(
      home,
      `
      const legacyData = join(${JSON.stringify(home)}, ".opencode-mem", "data");
      initConfigWithLegacyMigration("/tmp/nonexistent-project");
      return {
        storagePath: cfg.CONFIG.storagePath,
        keepsLegacy: cfg.CONFIG.storagePath === legacyData,
        ommsDataCreated: existsSync(join(${JSON.stringify(home)}, ".omms", "data")),
      };
      `
    );

    expect(result.ok).toBe(true);
    expect(result.keepsLegacy).toBe(true);
    expect(result.ommsDataCreated).toBe(false);
  });

  it("skips migration entirely when storagePath is configured explicitly", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-config-test-"));
    tempDirs.push(home);
    seedLegacyLayout(home);
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(
      join(home, ".config", "omms", "omms.jsonc"),
      '{ "storagePath": "/tmp/custom-store" }',
      "utf-8"
    );

    const result = await runConfigScenario(
      home,
      `
      initConfigWithLegacyMigration("/tmp/nonexistent-project");
      return {
        storagePath: cfg.CONFIG.storagePath,
        markerCreated: existsSync(join(${JSON.stringify(home)}, ".omms", "migration-marker.json")),
        backupCreated: existsSync(join(${JSON.stringify(home)}, ".omms", "backups")),
      };
      `
    );

    expect(result.ok).toBe(true);
    expect(result.storagePath).toBe("/tmp/custom-store");
    expect(result.markerCreated).toBe(false);
    expect(result.backupCreated).toBe(false);
  });
});
