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
    const { readFileSync, existsSync, writeFileSync } = await import("node:fs");
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
  it("shows the six fields with their defaults and sources", async () => {
    const result = await scenario(`return (await (await send("/api/settings")).json()).settings;`);
    expect(result.maxMemories).toEqual({
      value: 10,
      source: "default",
      globalValue: 10,
      default: 10,
      hasGlobal: false,
    });
    expect(result["chatMessage.maxMemories"]).toEqual({
      value: 3,
      source: "default",
      globalValue: 3,
      default: 3,
      hasGlobal: false,
    });
    expect(result.autoCaptureMaxContextBytes).toEqual({
      value: 131072,
      source: "default",
      globalValue: 131072,
      default: 131072,
      hasGlobal: false,
    });
    expect(result.userProfileMaxContextBytes).toEqual({
      value: 32768,
      source: "default",
      globalValue: 32768,
      default: 32768,
      hasGlobal: false,
    });
    expect(result.retrievalMaxTokens).toEqual({
      value: 2000,
      source: "default",
      globalValue: 2000,
      default: 2000,
      hasGlobal: false,
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
      hasGlobal: true,
    });
    expect(result.maxMemories).toEqual({
      value: 8,
      source: "global",
      globalValue: 8,
      default: 10,
      hasGlobal: true,
    });
    expect(result["chatMessage.maxMemories"]).toEqual({
      value: 4,
      source: "global",
      globalValue: 4,
      default: 3,
      hasGlobal: true,
    });
    expect(result.autoCaptureMaxContextBytes).toEqual({
      value: 65536,
      source: "global",
      globalValue: 65536,
      default: 131072,
      hasGlobal: true,
    });
    expect(result.userProfileMaxContextBytes).toEqual({
      value: 8192,
      source: "global",
      globalValue: 8192,
      default: 32768,
      hasGlobal: true,
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
        hasGlobal: false,
      });
    }
  });

  it("switching the embedder changes the threshold row's default in the snapshot", async () => {
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const { initConfig } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
        initConfig(join(home, "project"));
        const before = (await (await send("/api/settings")).json()).settings.similarityThreshold;
        writeFileSync(configPath, JSON.stringify({ embeddingModel: "qwen3-embedding:0.6b" }) + "\\n");
        const { refreshConfigIfChanged } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
        refreshConfigIfChanged(join(home, "project"));
        const after = (await (await send("/api/settings")).json()).settings.similarityThreshold;
        return { before, after };
      `
    );
    expect(result.before).toEqual({
      value: 0.6,
      source: "default",
      globalValue: 0.6,
      default: 0.6,
      hasGlobal: false,
    });
    expect(result.after).toEqual({
      value: 0.5,
      source: "default",
      globalValue: 0.5,
      default: 0.5,
      hasGlobal: false,
    });
  });

  it("integer rows still refuse a fraction while the threshold row accepts one", async () => {
    const seed = '{ "maxMemories": 10, "similarityThreshold": 0.6 }\n';
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const revision = (await (await send("/api/settings")).json()).revision;
        const fraction = await send("/api/settings", "PATCH",
          { edits: { maxMemories: 2.5 }, revision }, json);
        const decimal = await send("/api/settings", "PATCH",
          { edits: { similarityThreshold: 0.45 }, revision }, json);
        const after = await (await send("/api/settings")).json();
        return { fraction: fraction.status, decimal: decimal.status,
          text: readFileSync(configPath, "utf8"),
          threshold: after.settings.similarityThreshold };
      `,
      { globalConfig: seed }
    );
    expect(result.fraction).toBe(400);
    expect(result.decimal).toBe(200);
    expect(result.text).toContain('"similarityThreshold": 0.45');
    expect(result.threshold).toEqual({
      value: 0.45,
      source: "global",
      globalValue: 0.45,
      default: 0.6,
      hasGlobal: true,
    });
  });

  it("resolves the nested chatMessage.maxMemories with the runtime merge rules", async () => {
    const result = await scenario(
      `return (await (await send("/api/settings")).json()).settings["chatMessage.maxMemories"];`,
      {
        globalConfig: JSON.stringify({ chatMessage: { enabled: true, maxMemories: 5 } }),
        projectConfig: JSON.stringify({ chatMessage: { enabled: true } }),
      }
    );
    expect(result).toEqual({
      value: 3,
      source: "default",
      globalValue: 5,
      default: 3,
      hasGlobal: true,
    });
  });

  it("shows the similarityThreshold row with the embedder-aware default", async () => {
    const builtIn = await scenario(
      `return (await (await send("/api/settings")).json()).settings.similarityThreshold;`
    );
    expect(builtIn).toEqual({
      value: 0.6,
      source: "default",
      globalValue: 0.6,
      default: 0.6,
      hasGlobal: false,
    });

    const qwen = await scenario(
      `return (await (await send("/api/settings")).json()).settings.similarityThreshold;`,
      { globalConfig: JSON.stringify({ embeddingModel: "qwen3-embedding:0.6b" }) }
    );
    expect(qwen).toEqual({
      value: 0.5,
      source: "default",
      globalValue: 0.5,
      default: 0.5,
      hasGlobal: false,
    });

    const saved = await scenario(
      `return (await (await send("/api/settings")).json()).settings.similarityThreshold;`,
      { globalConfig: JSON.stringify({ similarityThreshold: 0.6 }) }
    );
    expect(saved).toEqual({
      value: 0.6,
      source: "global",
      globalValue: 0.6,
      default: 0.6,
      hasGlobal: true,
    });
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
    expect(result.snapshot).toEqual({
      value: 2,
      source: "global",
      globalValue: 2,
      default: 3,
      hasGlobal: true,
    });
    expect(result.text).toContain('"piModel": "keep"');
    expect(result.text).toContain('"maxMemories": 12');
    expect(result.text).toMatch(/"chatMessage"\s*:\s*\{/);
    expect(result.text).toContain('"maxMemories": 2');
    expect(result.text).not.toContain('"chatMessage.maxMemories"');
  });
});

describe("memory settings reset to default", () => {
  it("removes the key when a request sends null for a memory limit", async () => {
    const seed = [
      "{",
      "  // keep me",
      '  "maxMemories": 6,',
      '  "similarityThreshold": 0.6,',
      "  // model comment",
      '  "memoryModel": "keep-model"',
      "}",
      "",
    ].join("\n");
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const { initConfig } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
        initConfig(join(home, "project"));
        const before = await (await send("/api/settings")).json();
        const reset = await send("/api/settings", "PATCH",
          { edits: { maxMemories: null }, revision: before.revision }, json);
        const after = await (await send("/api/settings")).json();
        return { status: reset.status,
          text: readFileSync(configPath, "utf8"),
          maxMemories: after.settings.maxMemories };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(200);
    // A comment on another property stays; the removed key's own comment goes with it.
    expect(result.text).toContain("// model comment");
    expect(result.text).toContain('"similarityThreshold": 0.6');
    expect(result.text).toContain('"memoryModel": "keep-model"');
    expect(result.text).not.toMatch(/"maxMemories"\s*:/);
    expect(result.maxMemories).toEqual({
      value: 10,
      source: "default",
      globalValue: 10,
      default: 10,
      hasGlobal: false,
    });
  });

  it("removes only the chatMessage.maxMemories leaf and keeps siblings and comments", async () => {
    const seed = [
      "{",
      '  "chatMessage": {',
      "    // recent memories at session start",
      '    "enabled": true,',
      '    "excludeCurrentSession": false,',
      '    "maxAgeDays": 14,',
      '    "injectOn": "always",',
      "    // recent memories injected at session start",
      '    "maxMemories": 4',
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const reset = await send("/api/settings", "PATCH",
          { edits: { "chatMessage.maxMemories": null }, revision: before.revision }, json);
        const after = await (await send("/api/settings")).json();
        return { status: reset.status, text: readFileSync(configPath, "utf8"),
          chatMax: after.settings["chatMessage.maxMemories"] };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(200);
    expect(result.text).toContain("    // recent memories at session start");
    expect(result.text).toContain('"enabled": true');
    expect(result.text).toContain('"excludeCurrentSession": false');
    expect(result.text).toContain('"maxAgeDays": 14');
    expect(result.text).toContain('"injectOn": "always"');
    // The removed leaf is the nested one only.
    expect(result.text).toMatch(/"chatMessage"\s*:\s*\{/);
    expect(result.text).not.toMatch(/"maxMemories"\s*:/);
    expect(result.chatMax).toEqual({
      value: 3,
      source: "default",
      globalValue: 3,
      default: 3,
      hasGlobal: false,
    });
  });

  it("resets similarityThreshold so the default follows the embedder again", async () => {
    const seed = JSON.stringify({
      embeddingModel: "qwen3-embedding:0.6b",
      similarityThreshold: 0.6,
    });
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const { initConfig } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
        initConfig(join(home, "project"));
        const before = await (await send("/api/settings")).json();
        const reset = await send("/api/settings", "PATCH",
          { edits: { similarityThreshold: null }, revision: before.revision }, json);
        const after = await (await send("/api/settings")).json();
        return { status: reset.status, text: readFileSync(configPath, "utf8"),
          threshold: after.settings.similarityThreshold };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(200);
    expect(result.text).not.toMatch(/"similarityThreshold"\s*:/);
    expect(result.text).toContain('"embeddingModel": "qwen3-embedding:0.6b"');
    expect(result.threshold).toEqual({
      value: 0.5,
      source: "default",
      globalValue: 0.5,
      default: 0.5,
      hasGlobal: false,
    });
  });

  it("treats a reset of an absent key as a no-op", async () => {
    const seed = '{ "maxMemories": 6, "memoryModel": "keep-model" }\n';
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const reset = await send("/api/settings", "PATCH",
          { edits: { retrievalMaxTokens: null }, revision: before.revision }, json);
        return { status: reset.status, text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(200);
    expect(result.text).toBe(seed);
  });

  it("refuses a reset after another editor changed the file, without writing", async () => {
    const seed = '{ "maxMemories": 6 }\n';
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        writeFileSync(configPath, JSON.stringify({ maxMemories: 7 }) + "\\n");
        const stale = await send("/api/settings", "PATCH",
          { edits: { maxMemories: null }, revision: before.revision }, json);
        return { status: stale.status, text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(409);
    expect(result.text).toBe('{"maxMemories":7}\n');
  });

  it("leaves the project file untouched on a reset", async () => {
    const project = JSON.stringify({ maxMemories: 5 });
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const reset = await send("/api/settings", "PATCH",
          { edits: { maxMemories: null }, revision: before.revision }, json);
        return { status: reset.status,
          projectText: readFileSync(join(home, "project", ".opencode", "omms.jsonc"), "utf8"),
          globalText: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: '{ "maxMemories": 6 }\n', projectConfig: project }
    );
    expect(result.status).toBe(200);
    expect(result.projectText).toBe(project);
    expect(result.globalText).not.toMatch(/"maxMemories"\s*:/);
  });

  it("refuses null for a setting that is not a memory limit", async () => {
    const seed = '{ "piModel": "keep", "maxMemories": 6 }\n';
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const before = await (await send("/api/settings")).json();
        const reset = await send("/api/settings", "PATCH",
          { edits: { piModel: null }, revision: before.revision }, json);
        return { status: reset.status, text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: seed }
    );
    expect(result.status).toBe(400);
    expect(result.text).toBe(seed);
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
          // null was a wrong-type case until it became the reset-to-default
          // wire form (openspec retrieval-threshold-and-reranker); true replaces it.
          ["retrievalMaxTokens", 0], ["retrievalMaxTokens", 255], ["retrievalMaxTokens", 65537],
          ["retrievalMaxTokens", 2000.5], ["retrievalMaxTokens", "3000"], ["retrievalMaxTokens", true],
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
    expect(result.snapshot).toEqual({
      value: 2,
      source: "global",
      globalValue: 2,
      default: 3,
      hasGlobal: true,
    });
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
