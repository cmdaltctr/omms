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

describe("keywordMode in the settings API", () => {
  it("shows boost as the default", async () => {
    const result = await scenario(
      `return (await (await send("/api/settings")).json()).settings.keywordMode;`
    );
    expect(result).toEqual({ value: "boost", source: "default", globalValue: "boost" });
  });

  it("saves rrf and shows it as a global value", async () => {
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const revision = (await (await send("/api/settings")).json()).revision;
        const saved = await send("/api/settings", "PATCH", { edits: { keywordMode: "rrf" }, revision }, json);
        const after = await (await send("/api/settings")).json();
        return { status: saved.status, text: readFileSync(configPath, "utf8"), mode: after.settings.keywordMode };
      `
    );
    expect(result.status).toBe(200);
    expect(result.text).toContain('"keywordMode": "rrf"');
    expect(result.mode).toEqual({ value: "rrf", source: "global", globalValue: "rrf" });
  });

  it("refuses an unknown mode without echoing it", async () => {
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const revision = (await (await send("/api/settings")).json()).revision;
        const saved = await send("/api/settings", "PATCH", { edits: { keywordMode: "fusion-secret" }, revision }, json);
        return { status: saved.status, body: await saved.text(), text: readFileSync(configPath, "utf8") };
      `
    );
    expect(result.status).toBe(400);
    expect(result.body).toContain("keywordMode");
    expect(result.body).not.toContain("fusion-secret");
    expect(result.text).not.toContain("keywordMode");
  });

  it("resets to the default when null is saved", async () => {
    const result = await scenario(
      `
        const json = { "content-type": "application/json" };
        const revision = (await (await send("/api/settings")).json()).revision;
        const saved = await send("/api/settings", "PATCH", { edits: { keywordMode: null }, revision }, json);
        return { status: saved.status, text: readFileSync(configPath, "utf8") };
      `,
      { globalConfig: '{ "keywordMode": "rrf" }' }
    );
    expect(result.status).toBe(200);
    expect(result.text).not.toContain("keywordMode");
  });

  it("shows a project override as the effective value", async () => {
    const result = await scenario(
      `return (await (await send("/api/settings")).json()).settings.keywordMode;`,
      { globalConfig: '{ "keywordMode": "boost" }', projectConfig: '{ "keywordMode": "rrf" }' }
    );
    expect(result).toEqual({ value: "rrf", source: "project", globalValue: "boost" });
  });
});
