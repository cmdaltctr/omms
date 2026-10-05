import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * Each scenario runs a real WebServer against a temp HOME, mirroring
 * tests/web-settings-api.test.ts, so the settings snapshot, the save route,
 * and its security guards are exercised together.
 */
async function scenario(
  body: string,
  options: { globalConfig?: string; projectConfig?: string; legacyConfig?: string } = {}
) {
  const home = mkdtempSync(join(tmpdir(), "omms-memory-settings-"));
  dirs.push(home);
  const project = join(home, "project");
  mkdirSync(join(project, ".opencode"), { recursive: true });
  if (options.projectConfig !== undefined) {
    writeFileSync(join(project, ".opencode", "omms.jsonc"), options.projectConfig);
  }
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  const legacyPath = join(home, ".config", "opencode", "opencode-mem.jsonc");
  if (options.legacyConfig !== undefined) {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(legacyPath, options.legacyConfig);
  } else {
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(configPath, options.globalConfig ?? "{}");
  }
  const serverUrl = pathToFileURL(join(import.meta.dir, "../src/services/web-server.ts")).href;
  const tokenUrl = pathToFileURL(join(import.meta.dir, "../src/services/auth-token.ts")).href;
  const apiTokensUrl = pathToFileURL(join(import.meta.dir, "../src/services/api-tokens.ts")).href;
  const script = `
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { WebServer } = await import(${JSON.stringify(serverUrl)});
    const { getOrCreateAuthToken } = await import(${JSON.stringify(tokenUrl)});
    const token = getOrCreateAuthToken();
    (await import(${JSON.stringify(apiTokensUrl)})).importConfigApiToken("network-test-token");
    const home = ${JSON.stringify(home)};
    const configPath = ${JSON.stringify(configPath)};
    const legacyPath = ${JSON.stringify(legacyPath)};
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
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

describe("memory settings snapshot", () => {
  it("shows the five fields with their defaults and sources", async () => {
    const result = await scenario(`return (await (await send("/api/settings")).json()).settings;`);
    expect(result.maxMemories).toEqual({
      value: 10,
      source: "default",
      globalValue: 10,
      default: 10,
    });
    expect(result["chatMessage.maxMemories"]).toEqual({
      value: 3,
      source: "default",
      globalValue: 3,
      default: 3,
    });
    expect(result.autoCaptureMaxContextBytes).toEqual({
      value: 131072,
      source: "default",
      globalValue: 131072,
      default: 131072,
    });
    expect(result.userProfileMaxContextBytes).toEqual({
      value: 32768,
      source: "default",
      globalValue: 32768,
      default: 32768,
    });
    expect(result.retrievalMaxTokens).toEqual({
      value: 2000,
      source: "default",
      globalValue: 2000,
      default: 2000,
    });
  });

  it("shows global values, effective project values, and sources", async () => {
    const result = await scenario(`return (await (await send("/api/settings")).json()).settings;`, {
      globalConfig: JSON.stringify({
        maxMemories: 8,
        chatMessage: { maxMemories: 4 },
        autoCaptureMaxContextBytes: 65536,
        userProfileMaxContextBytes: 8192,
        retrievalMaxTokens: 3000,
      }),
      projectConfig: JSON.stringify({ retrievalMaxTokens: 1000 }),
    });
    expect(result.retrievalMaxTokens).toEqual({
      value: 1000,
      source: "project",
      globalValue: 3000,
      default: 2000,
    });
    expect(result.maxMemories).toEqual({ value: 8, source: "global", globalValue: 8, default: 10 });
    expect(result["chatMessage.maxMemories"]).toEqual({
      value: 4,
      source: "global",
      globalValue: 4,
      default: 3,
    });
    expect(result.autoCaptureMaxContextBytes).toEqual({
      value: 65536,
      source: "global",
      globalValue: 65536,
      default: 131072,
    });
    expect(result.userProfileMaxContextBytes).toEqual({
      value: 8192,
      source: "global",
      globalValue: 8192,
      default: 32768,
    });
  });

  it("keeps global defaults separate from project-only limits", async () => {
    const overrides = {
      maxMemories: 6,
      autoCaptureMaxContextBytes: 65536,
      userProfileMaxContextBytes: 8192,
      retrievalMaxTokens: 1000,
    };
    const defaults = {
      maxMemories: 10,
      autoCaptureMaxContextBytes: 131072,
      userProfileMaxContextBytes: 32768,
      retrievalMaxTokens: 2000,
    };
    const configUrl = pathToFileURL(join(import.meta.dir, "../src/config.ts")).href;
    const result = await scenario(
      `const { initConfig } = await import(${JSON.stringify(configUrl)});
       initConfig(join(home, "project"));
       return (await (await send("/api/settings")).json()).settings;`,
      { projectConfig: JSON.stringify(overrides) }
    );
    for (const key of Object.keys(overrides) as (keyof typeof overrides)[]) {
      expect(result[key]).toEqual({
        value: overrides[key],
        source: "project",
        globalValue: defaults[key],
        default: defaults[key],
      });
    }
  });

  it("resolves the nested chatMessage.maxMemories with the runtime merge rules", async () => {
    const result = await scenario(
      `return (await (await send("/api/settings")).json()).settings["chatMessage.maxMemories"];`,
      {
        globalConfig: JSON.stringify({ chatMessage: { enabled: true, maxMemories: 5 } }),
        projectConfig: JSON.stringify({ chatMessage: { enabled: true } }),
      }
    );
    expect(result).toEqual({ value: 3, source: "default", globalValue: 5, default: 3 });
  });
});

describe("memory settings saves", () => {
  it("saves all five settings, refreshes the revision, and lets another card save afterwards", async () => {
    const result = await scenario(`
      const json = { "content-type": "application/json" };
      const before = await (await send("/api/settings")).json();
      const saved = await send("/api/settings", "PATCH", { edits: {
        maxMemories: 7, "chatMessage.maxMemories": 2, autoCaptureMaxContextBytes: 65536,
        userProfileMaxContextBytes: 8192, retrievalMaxTokens: 3000 }, revision: before.revision }, json);
      const savedStatus = saved.status;
      const after = await (await send("/api/settings")).json();
      const otherCard = await send("/api/settings", "PATCH",
        { edits: { piModel: "new-model" }, revision: after.revision }, json);
      const staleOtherCard = await send("/api/settings", "PATCH",
        { edits: { piModel: "stale" }, revision: before.revision }, json);
      return { savedStatus, revisionChanged: after.revision !== before.revision,
        text: readFileSync(configPath, "utf8"), settings: after.settings,
        otherStatus: otherCard.status, staleStatus: staleOtherCard.status };
    `);
    expect(result.savedStatus).toBe(200);
    expect(result.revisionChanged).toBe(true);
    expect(result.settings.maxMemories.globalValue).toBe(7);
    expect(result.settings["chatMessage.maxMemories"].globalValue).toBe(2);
    expect(result.settings.autoCaptureMaxContextBytes.globalValue).toBe(65536);
    expect(result.settings.userProfileMaxContextBytes.globalValue).toBe(8192);
    expect(result.settings.retrievalMaxTokens.globalValue).toBe(3000);
    expect(result.text).toContain('"retrievalMaxTokens": 3000');
    expect(result.text).toContain('"maxMemories": 2');
    expect(result.text).not.toContain('"chatMessage.maxMemories"');
    expect(result.otherStatus).toBe(200);
    expect(result.staleStatus).toBe(409);
  });

  it("writes the nested leaf while preserving siblings, comments, order, and unrelated keys", async () => {
    const seed = [
      "{",
      "  // owner comment",
      '  "maxMemories": 12,',
      '  "memoryModel": "keep-model",',
      '  "chatMessage": {',
      "    // recent memories at session start",
      '    "enabled": true,',
      '    "excludeCurrentSession": false,',
      '    "maxAgeDays": 14,',
      '    "injectOn": "always"',
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const saved = await send("/api/settings", "PATCH",
          { edits: { "chatMessage.maxMemories": 2 }, revision: before.revision }, json);
        return { status: saved.status, text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(200);
    expect(result.text).toContain("// owner comment");
    expect(result.text).toContain("// recent memories at session start");
    expect(result.text).toContain('"maxMemories": 12');
    expect(result.text).toContain('"memoryModel": "keep-model"');
    expect(result.text).toContain('"enabled": true');
    expect(result.text).toContain('"excludeCurrentSession": false');
    expect(result.text).toContain('"maxAgeDays": 14');
    expect(result.text).toContain('"injectOn": "always"');
    expect(result.text).toContain('"maxMemories": 2');
    expect(result.text).not.toContain('"chatMessage.maxMemories"');
    // Key order stays: top-level maxMemories and memoryModel before chatMessage.
    expect(result.text.indexOf('"maxMemories": 12')).toBeLessThan(
      result.text.indexOf('"chatMessage"')
    );
    expect(result.text.indexOf('"memoryModel"')).toBeLessThan(result.text.indexOf('"chatMessage"'));
  });

  it("creates the chatMessage object when absent and leaves other keys untouched", async () => {
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const saved = await send("/api/settings", "PATCH",
          { edits: { "chatMessage.maxMemories": 2 }, revision: before.revision }, json);
        const after = await (await send("/api/settings")).json();
        return { status: saved.status, text: readFileSync(configPath, "utf8"),
          snapshot: after.settings["chatMessage.maxMemories"] };
      `,
      { globalConfig: '{ "maxMemories": 12, "piModel": "keep" }\n' }
    );
    expect(result.status).toBe(200);
    expect(result.snapshot).toEqual({ value: 2, source: "global", globalValue: 2, default: 3 });
    expect(result.text).toContain('"piModel": "keep"');
    expect(result.text).toContain('"maxMemories": 12');
    expect(result.text).toMatch(/"chatMessage"\s*:\s*\{/);
    expect(result.text).toContain('"maxMemories": 2');
    expect(result.text).not.toContain('"chatMessage.maxMemories"');
  });
});

describe("memory settings rejections", () => {
  it("rejects invalid memory values with accepted values and leaves the file unchanged", async () => {
    const seed = '{ "retrievalMaxTokens": 2500, "maxMemories": 9 }\n';
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const rows = [];
        const invalid = [
          ["retrievalMaxTokens", 0], ["retrievalMaxTokens", 255], ["retrievalMaxTokens", 65537],
          ["retrievalMaxTokens", 2000.5], ["retrievalMaxTokens", "3000"], ["retrievalMaxTokens", null],
          ["maxMemories", -1], ["maxMemories", 1.5], ["maxMemories", "4"],
          ["chatMessage.maxMemories", 0], ["chatMessage.maxMemories", 2.5],
          ["userProfileMaxContextBytes", 1023], ["userProfileMaxContextBytes", 16777217],
          ["autoCaptureMaxContextBytes", 16383], ["autoCaptureMaxContextBytes", 16777217],
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
    // Rejections name the setting and accepted values; they never echo the value.
    const echoed = result.rows.find(
      (row: { key: string; error?: string }) =>
        row.key === "retrievalMaxTokens" && row.error?.includes("3000")
    );
    expect(echoed).toBeUndefined();
    const ranges: Record<string, string[]> = {
      retrievalMaxTokens: ["256", "65536"],
      maxMemories: ["positive"],
      "chatMessage.maxMemories": ["positive"],
      userProfileMaxContextBytes: ["1024", "16777216"],
      autoCaptureMaxContextBytes: ["16384", "16777216"],
    };
    for (const row of result.rows) {
      expect(row.status, `${row.key} must be rejected`).toBe(400);
      expect(row.error).toContain(row.key);
      for (const text of ranges[row.key]) {
        expect(row.error, `${row.key} error must mention ${text}`).toContain(text);
      }
    }
  });

  it("rejects unsupported nested edits without writing any part of the request", async () => {
    const seed = '{ "retrievalMaxTokens": 2500 }\n';
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const mixed = await send("/api/settings", "PATCH",
          { edits: { retrievalMaxTokens: 3000, "chatMessage.enabled": false }, revision: before.revision }, json);
        const revision = (await (await send("/api/settings")).json()).revision;
        const maxAge = await send("/api/settings", "PATCH",
          { edits: { "chatMessage.maxAgeDays": 5 }, revision }, json);
        return { mixed: mixed.status, maxAge: maxAge.status, text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: seed }
    );
    expect(result.mixed).toBe(400);
    expect(result.maxAge).toBe(400);
    expect(result.text).toBe(seed);
  });

  it("refuses a save after another editor changed the file, then accepts a reviewed save", async () => {
    const result = await scenario(`
      const json = { "content-type": "application/json" };
      const before = await (await send("/api/settings")).json();
      const { writeFileSync } = await import("node:fs");
      writeFileSync(configPath, JSON.stringify({ retrievalMaxTokens: 2600, maxMemories: 9 }) + "\\n");
      const stale = await send("/api/settings", "PATCH",
        { edits: { retrievalMaxTokens: 3000 }, revision: before.revision }, json);
      const after = await (await send("/api/settings")).json();
      const retried = await send("/api/settings", "PATCH",
        { edits: { retrievalMaxTokens: 3000 }, revision: after.revision }, json);
      return { stale: stale.status, retried: retried.status, text: readFileSync(configPath, "utf8") };
    `);
    expect(result.stale).toBe(409);
    expect(result.retried).toBe(200);
    // The seed is compact JSON.stringify output; the writer keeps its style.
    expect(result.text).toMatch(/"retrievalMaxTokens":\s*3000/);
    expect(result.text).toMatch(/"maxMemories":\s*9/);
  });

  it("migrates a legacy-only config on the first memory save and never writes the legacy file", async () => {
    const legacy = [
      "{",
      "  // legacy note",
      '  "maxMemories": 11,',
      '  "memoryModel": "keep-model"',
      "}",
      "",
    ].join("\n");
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const saved = await send("/api/settings", "PATCH",
          { edits: { "chatMessage.maxMemories": 2 }, revision: before.revision }, json);
        const after = await (await send("/api/settings")).json();
        return { status: saved.status, body: await saved.json(),
          migrated: existsSync(configPath) ? readFileSync(configPath, "utf8") : null,
          legacyText: readFileSync(legacyPath, "utf8"),
          snapshot: after.settings["chatMessage.maxMemories"],
          maxMemories: after.settings.maxMemories.globalValue };
      `,
      { legacyConfig: legacy }
    );
    expect(result.status).toBe(200);
    expect(result.body.migratedLegacy).toBe(true);
    expect(result.legacyText).toBe(legacy);
    expect(result.migrated).toContain("// legacy note");
    expect(result.migrated).toContain('"maxMemories": 11');
    expect(result.migrated).toContain('"memoryModel": "keep-model"');
    expect(result.migrated).toContain('"maxMemories": 2');
    expect(result.migrated).not.toContain('"chatMessage.maxMemories"');
    expect(result.snapshot).toEqual({ value: 2, source: "global", globalValue: 2, default: 3 });
    expect(result.maxMemories).toBe(11);
  });

  it("keeps the JSON, origin, and auth guards for memory edits", async () => {
    const seed = '{ "retrievalMaxTokens": 2500 }\n';
    const result = await scenario(
      `
        const form = await send("/api/settings", "PATCH",
          { edits: { retrievalMaxTokens: 3000 }, revision: "unused" }, { "content-type": "text/plain" });
        const foreign = await send("/api/settings", "PATCH",
          { edits: { retrievalMaxTokens: 3000 }, revision: "unused" },
          { origin: "https://example.com", "content-type": "application/json" });
        const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
        const noToken = await network.handleRequest(new Request("http://127.0.0.1:4747/api/settings", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ edits: { retrievalMaxTokens: 3000 }, revision: "unused" }) }));
        return { form: form.status, foreign: foreign.status, noToken: noToken.status,
          text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: seed }
    );
    expect(result.form).toBe(415);
    expect(result.foreign).toBe(403);
    expect(result.noToken).toBe(401);
    expect(result.text).toBe(seed);
  });
});
