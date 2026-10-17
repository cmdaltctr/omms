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
const rerankerUrl = pathToFileURL(join(import.meta.dir, "../src/services/reranker.js")).href;

/** Child-process scenario with a temp HOME (same pattern as threshold-config.test.ts). */
async function rerankerConfigScenario(
  files: { global?: string; project?: string },
  body: string
): Promise<any> {
  const home = mkdtempSync(join(tmpdir(), "omms-reranker-cfg-"));
  tempDirs.push(home);
  const project = mkdtempSync(join(tmpdir(), "omms-reranker-proj-"));
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
const cfg = await import(${JSON.stringify(configUrl)});
const { rerankSettingsFrom } = await import(${JSON.stringify(rerankerUrl)});
const project = ${JSON.stringify(project)};
try {
  const result = await (async () => { ${body} })();
  console.log("RERANKER_CFG_RESULT:" + JSON.stringify(result));
} catch (error) {
  console.log("RERANKER_CFG_RESULT:" + JSON.stringify({ error: String(error) }));
}
`;
  const dir = mkdtempSync(join(tmpdir(), "omms-reranker-script-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_SKIP_LEGACY_MIGRATION: "1" },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RERANKER_CFG_RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

const webServerUrl = pathToFileURL(join(import.meta.dir, "../src/services/web-server.ts")).href;
const authTokenUrl = pathToFileURL(join(import.meta.dir, "../src/services/auth-token.ts")).href;
const apiTokensUrl = pathToFileURL(join(import.meta.dir, "../src/services/api-tokens.ts")).href;

/** Web-server scenario mirroring tests/memory-limits-settings.test.ts. */
async function rerankerWebScenario(
  body: string,
  options: { globalConfig?: string; projectConfig?: string } = {}
): Promise<any> {
  const home = mkdtempSync(join(tmpdir(), "omms-reranker-web-"));
  tempDirs.push(home);
  const project = join(home, "project");
  mkdirSync(join(project, ".opencode"), { recursive: true });
  if (options.projectConfig !== undefined) {
    writeFileSync(join(project, ".opencode", "omms.jsonc"), options.projectConfig);
  }
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  writeFileSync(configPath, options.globalConfig ?? "{}");
  const script = `
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { WebServer } = await import(${JSON.stringify(webServerUrl)});
    const { getOrCreateAuthToken } = await import(${JSON.stringify(authTokenUrl)});
    const token = getOrCreateAuthToken();
    (await import(${JSON.stringify(apiTokensUrl)})).importConfigApiToken("network-test-token");
    const home = ${JSON.stringify(home)};
    const configPath = ${JSON.stringify(configPath)};
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const send = (path, method = "GET", body, headers = {}) => server.handleRequest(
      new Request("http://127.0.0.1:4747" + path, { method,
        headers: { "x-omms-token": token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    );
    const output = await (async () => { ${body} })();
    console.log("RESULT:" + JSON.stringify(output));
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

describe("reranker settings save and snapshot", () => {
  it("saves the five keys, refreshes the revision, and never writes the value into errors", async () => {
    const result = await rerankerWebScenario(`
      const json = { "content-type": "application/json" };
      const before = await (await send("/api/settings")).json();
      const saved = await send("/api/settings", "PATCH", { edits: {
        rerankerEnabled: true,
        rerankerApiUrl: "http://127.0.0.1:3008/v1",
        rerankerModel: "Qwen3-Reranker-0.6B",
        rerankerApiKey: "env://OMMS_RERANK_KEY",
        rerankerTimeoutMs: 6000 }, revision: before.revision }, json);
      const after = await (await send("/api/settings")).json();
      return { status: saved.status, error: await saved.json().catch(() => null),
        text: readFileSync(configPath, "utf8"),
        settings: after.settings,
        secrets: after.secrets };
    `);
    expect(result.status).toBe(200);
    expect(result.text).toContain('"rerankerEnabled": true');
    expect(result.text).toContain('"rerankerApiUrl": "http://127.0.0.1:3008/v1"');
    expect(result.text).toContain('"rerankerModel": "Qwen3-Reranker-0.6B"');
    expect(result.text).toContain('"rerankerApiKey": "env://OMMS_RERANK_KEY"');
    expect(result.text).toContain('"rerankerTimeoutMs": 6000');
    expect(result.settings.rerankerEnabled).toEqual({
      value: true,
      source: "global",
      globalValue: true,
    });
    expect(result.settings.rerankerTimeoutMs).toEqual({
      value: 6000,
      source: "global",
      globalValue: 6000,
    });
    expect(result.secrets.rerankerApiKey).toMatchObject({
      set: true,
      source: "env",
      reference: "OMMS_RERANK_KEY",
    });
  });

  it("removes a saved reranker key when the edit sends null", async () => {
    const result = await rerankerWebScenario(`
      const json = { "content-type": "application/json" };
      const before = await (await send("/api/settings")).json();
      await send("/api/settings", "PATCH", { edits: { rerankerApiKey: "env://OMMS_RERANK_KEY" }, revision: before.revision }, json);
      const again = await (await send("/api/settings")).json();
      const cleared = await send("/api/settings", "PATCH", { edits: { rerankerApiKey: null }, revision: again.revision }, json);
      return { status: cleared.status, text: readFileSync(configPath, "utf8") };
    `);
    expect(result.status).toBe(200);
    expect(result.text).not.toContain("rerankerApiKey");
  });

  it("rejects invalid reranker edits without writing", async () => {
    const seed = '{ "memoryModel": "keep" }\n';
    const result = await rerankerWebScenario(
      `
      const json = { "content-type": "application/json" };
      const rows = [];
      const invalid = [
        ["rerankerEnabled", "yes"], ["rerankerEnabled", null],
        ["rerankerApiUrl", "ftp://x"], ["rerankerApiUrl", ""],
        ["rerankerModel", " "], ["rerankerApiKey", "sk-literal"],
        ["rerankerTimeoutMs", 499], ["rerankerTimeoutMs", 30001],
        ["rerankerTimeoutMs", 2000.5], ["rerankerTimeoutMs", null], ["rerankerTimeoutMs", "2000"],
        ["rerankerApiUrl", "SECRET-BAD-URL"],
      ];
      for (const [key, value] of invalid) {
        const revision = (await (await send("/api/settings")).json()).revision;
        const response = await send("/api/settings", "PATCH",
          { edits: { [key]: value }, revision }, json);
        rows.push({ key, status: response.status, error: (await response.json()).error });
      }
      return { rows, text: readFileSync(configPath, "utf8") };
    `,
      { globalConfig: seed }
    );
    expect(result.text).toBe(seed);
    for (const row of result.rows) {
      expect(row.status, `${row.key} must be rejected`).toBe(400);
      expect(row.error).toContain(row.key);
    }
    expect(
      result.rows.find((row: { error?: string }) => row.error?.includes("SECRET-BAD"))
    ).toBeUndefined();
  });

  it("marks the reranker keys global-only: a project file value never shows", async () => {
    const result = await rerankerWebScenario(
      `
      const { initConfig } = await import(${JSON.stringify(configUrl)});
      initConfig(join(home, "project"));
      return (await (await send("/api/settings")).json()).settings;
    `,
      {
        globalConfig: JSON.stringify({ rerankerApiUrl: "http://127.0.0.1:3008/v1" }),
        projectConfig: JSON.stringify({
          rerankerApiUrl: "http://evil.example.com/v1",
          rerankerTimeoutMs: 30000,
        }),
      }
    );
    expect(result.rerankerApiUrl).toEqual({
      value: "http://127.0.0.1:3008/v1",
      source: "global",
      globalValue: "http://127.0.0.1:3008/v1",
    });
    expect(result.rerankerTimeoutMs).toEqual({
      value: 4000,
      source: "default",
      globalValue: 4000,
    });
  });
});

describe("reranker config validation", () => {
  it("accepts a complete, valid reranker block", async () => {
    const result = await rerankerConfigScenario(
      {
        global: JSON.stringify({
          rerankerEnabled: true,
          rerankerApiUrl: "http://127.0.0.1:3008/v1",
          rerankerModel: "Qwen3-Reranker-0.6B",
          rerankerApiKey: "env://OMMS_RERANK_KEY",
          rerankerTimeoutMs: 6000,
        }),
      },
      `
      cfg.initConfig(project);
      return {
        enabled: cfg.CONFIG.rerankerEnabled,
        url: cfg.CONFIG.rerankerApiUrl,
        model: cfg.CONFIG.rerankerModel,
        key: cfg.CONFIG.rerankerApiKey,
        timeout: cfg.CONFIG.rerankerTimeoutMs,
        settings: rerankSettingsFrom(cfg.CONFIG)?.timeoutMs,
      };
    `
    );
    expect(result).toEqual({
      enabled: true,
      url: "http://127.0.0.1:3008/v1",
      model: "Qwen3-Reranker-0.6B",
      key: "env://OMMS_RERANK_KEY",
      timeout: 6000,
      settings: 6000,
    });
  });

  it("defaults to off with the documented timeout and treats an incomplete setup as off", async () => {
    const result = await rerankerConfigScenario(
      { global: "{}\n" },
      `
      cfg.initConfig(project);
      return {
        enabled: cfg.CONFIG.rerankerEnabled,
        url: cfg.CONFIG.rerankerApiUrl,
        model: cfg.CONFIG.rerankerModel,
        timeout: cfg.CONFIG.rerankerTimeoutMs,
        offWhenUnset: rerankSettingsFrom(cfg.CONFIG) ?? null,
      };
    `
    );
    expect(result).toEqual({
      enabled: false,
      url: undefined,
      model: undefined,
      timeout: 4000,
      offWhenUnset: null,
    });
    const incomplete = await rerankerConfigScenario(
      { global: JSON.stringify({ rerankerEnabled: true, rerankerModel: "m" }) },
      `
      cfg.initConfig(project);
      return { treatedAsOff: rerankSettingsFrom(cfg.CONFIG) ?? null };
    `
    );
    expect(incomplete.treatedAsOff).toBeNull();
  });

  it("refuses every invalid value, naming the setting and never the value", async () => {
    const result = await rerankerConfigScenario(
      { global: "{}\n" },
      `
      const invalid = [
        ["rerankerEnabled", "yes"], ["rerankerEnabled", 1], ["rerankerEnabled", null],
        ["rerankerApiUrl", "ftp://example.com"], ["rerankerApiUrl", "not a url"],
        ["rerankerApiUrl", ""], ["rerankerApiUrl", null], ["rerankerApiUrl", 42],
        ["rerankerModel", ""], ["rerankerModel", "  "], ["rerankerModel", 7], ["rerankerModel", null],
        ["rerankerApiKey", "sk-literal-key"], ["rerankerApiKey", 5],
        ["rerankerTimeoutMs", 499], ["rerankerTimeoutMs", 30001], ["rerankerTimeoutMs", 2000.5],
        ["rerankerTimeoutMs", null], ["rerankerTimeoutMs", "2000"],
        // The values below must never reach an error message.
        ["rerankerApiUrl", "SECRET-BAD-URL"], ["rerankerApiKey", "SECRET-BAD-KEY"],
      ];
      const rows = invalid.map(([key, value]) => {
        try { cfg.validateGlobalConfig({ [key]: value }); return { key, error: null }; }
        catch (error) { return { key, error: String(error) }; }
      });
      return { rows };
    `
    );
    for (const row of result.rows) {
      expect(row.error, `${row.key} must be rejected`).not.toBeNull();
      expect(row.error).toContain(row.key);
    }
    const leaked = result.rows.find((row: { error?: string }) => row.error?.includes("SECRET-BAD"));
    expect(leaked).toBeUndefined();
  });

  it("accepts the timeout boundaries and both URL schemes", async () => {
    const result = await rerankerConfigScenario(
      { global: "{}\n" },
      `
      const valid = [
        { rerankerTimeoutMs: 500 }, { rerankerTimeoutMs: 30000 }, { rerankerTimeoutMs: 2000 },
        { rerankerApiUrl: "http://127.0.0.1:3008/v1" },
        { rerankerApiUrl: "https://rerank.example.com/v1" },
        { rerankerApiKey: "file://~/.config/omms/rerank.key" },
      ];
      const errors = [];
      for (const value of valid) {
        try { cfg.validateGlobalConfig(value); } catch (error) { errors.push(String(error)); }
      }
      return { errors };
    `
    );
    expect(result.errors).toEqual([]);
  });

  it("ignores reranker settings in a project file; the global value stays in force", async () => {
    const result = await rerankerConfigScenario(
      {
        global: JSON.stringify({
          rerankerApiUrl: "http://127.0.0.1:3008/v1",
          rerankerModel: "global-model",
          rerankerTimeoutMs: 6000,
        }),
        project: JSON.stringify({
          rerankerApiUrl: "http://evil.example.com/v1",
          rerankerModel: "project-model",
          rerankerTimeoutMs: 30000,
          rerankerEnabled: true,
        }),
      },
      `
      cfg.initConfig(project);
      return {
        url: cfg.CONFIG.rerankerApiUrl,
        model: cfg.CONFIG.rerankerModel,
        timeout: cfg.CONFIG.rerankerTimeoutMs,
        enabled: cfg.CONFIG.rerankerEnabled,
      };
    `
    );
    expect(result).toEqual({
      url: "http://127.0.0.1:3008/v1",
      model: "global-model",
      timeout: 6000,
      // The project's rerankerEnabled: true is ignored too; only the global
      // file may switch the reranker on.
      enabled: false,
    });
  });
});
