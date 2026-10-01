import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

/** Run web servers in their own process with a temporary home. */
async function scenario(body: string, globalConfig = "{}") {
  const home = mkdtempSync(join(tmpdir(), "omms-tokens-api-"));
  dirs.push(home);
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), globalConfig);
  const script = `
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const token = getOrCreateAuthToken();
    const json = { "content-type": "application/json" };
    const call = (server, path, { method = "GET", body, headers = {}, address = "127.0.0.1" } = {}) =>
      server.handleRequest(new Request("http://127.0.0.1:4747" + path, { method, headers: { ...json, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) }), address);
    const output = await (async () => { ${body} })();
    console.log("RESULT:" + JSON.stringify(output));
    process.exit(0);
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
  if (!match) throw new Error(text + error);
  return { result: JSON.parse(match[1]), home };
}

it("manages tokens only from this machine with the local token", async () => {
  const { result } = await scenario(`
    const local = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747 });
    const local_ = { "x-omms-token": token };
    const remote = await call(local, "/api/settings/tokens", { method: "POST", body: { name: "ci", expiresInDays: 30 }, headers: local_, address: "192.168.1.5" });
    const noLocal = await call(local, "/api/settings/tokens", { method: "POST", body: { name: "ci", expiresInDays: 30 } });
    const created = await call(local, "/api/settings/tokens", { method: "POST", body: { name: "ci", expiresInDays: 30 }, headers: local_ });
    const { value, token: row } = await created.json();
    const list = await (await call(local, "/api/settings/tokens", { headers: local_ })).json();
    const served = await call(network, "/api/stats", { headers: { authorization: "Bearer " + value }, address: "192.168.1.5" });
    const header = await call(network, "/api/stats", { headers: { "x-omms-token": value }, address: "192.168.1.5" });
    const revoke = await call(local, "/api/settings/tokens/" + row.id, { method: "DELETE", headers: local_ });
    const afterRevoke = await call(network, "/api/stats", { headers: { authorization: "Bearer " + value }, address: "192.168.1.5" });
    return { remote: remote.status, noLocal: noLocal.status, created: created.status, value, list,
      served: served.status, header: header.status, revoke: revoke.status, afterRevoke: afterRevoke.status };
  `);
  expect(result.remote).toBe(403);
  expect(result.noLocal).toBe(401);
  expect(result.created).toBe(201);
  expect(result.list.tokens).toHaveLength(1);
  expect(JSON.stringify(result.list)).not.toContain(result.value);
  expect(JSON.stringify(result.list)).not.toContain("hash");
  expect(result.served).toBe(200);
  expect(result.header).toBe(200);
  expect(result.revoke).toBe(200);
  expect(result.afterRevoke).toBe(401);
});

it("imports the config token once at start, then ignores the config key", async () => {
  const config = '{ "webServerApiToken": "config-token-value" }';
  const { result } = await scenario(
    `
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const path = join(process.env.HOME, ".config", "omms", "omms.jsonc");
    const before = readFileSync(path, "utf8");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const first = new WebServer({ enabled: true, host: "127.0.0.1", port, apiToken: "config-token-value" });
    await first.start();
    await first.stop();
    const second = new WebServer({ enabled: true, host: "127.0.0.1", port, apiToken: "edited-config-value" });
    await second.start();
    await second.stop();
    const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "edited-config-value" });
    const imported = await call(network, "/api/stats", { headers: { authorization: "Bearer config-token-value" }, address: "192.168.1.5" });
    const edited = await call(network, "/api/stats", { headers: { authorization: "Bearer edited-config-value" }, address: "192.168.1.5" });
    const list = await (await call(first, "/api/settings/tokens", { headers: { "x-omms-token": token } })).json();
    return { imported: imported.status, edited: edited.status, list: list.tokens,
      unchanged: readFileSync(path, "utf8") === before };
  `,
    config
  );
  expect(result.imported).toBe(200);
  expect(result.edited).toBe(401);
  expect(result.list).toMatchObject([{ name: "from config file", expiresAt: null }]);
  expect(result.unchanged).toBe(true);
});

it("refuses a network-bound start without a token or a password", async () => {
  const { result } = await scenario(`
    const server = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747 });
    try {
      await server.start();
      return { started: true };
    } catch (error) {
      return { started: false, message: String(error) };
    }
  `);
  expect(result.started).toBe(false);
  expect(result.message).toContain("API token");
  expect(result.message).toContain("browser password");
});

it("saves the browser password to a private key file and clears it", async () => {
  const { result } = await scenario(`
    const { existsSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const configPath = join(process.env.HOME, ".config", "omms", "omms.jsonc");
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const local_ = { "x-omms-token": token };
    const revision = async () => (await (await call(server, "/api/settings", { headers: local_ })).json()).revision;
    const remote = await call(server, "/api/settings/web-password", { method: "POST", headers: local_, address: "192.168.1.5",
      body: { password: "browser-secret-value", username: "me", revision: await revision() } });
    const saved = await call(server, "/api/settings/web-password", { method: "POST", headers: local_,
      body: { password: "browser-secret-value", username: "me", revision: await revision() } });
    const savedBody = await saved.text();
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const file = config.webServerAuthPassword.replace("file://", "");
    const fileText = readFileSync(file, "utf8").trim();
    const mode = statSync(file).mode & 0o777;
    const cleared = await call(server, "/api/settings/web-password", { method: "POST", headers: local_,
      body: { clear: true, revision: await revision() } });
    const after = JSON.parse(readFileSync(configPath, "utf8"));
    const log = existsSync(join(process.env.HOME, "omms.log")) ? readFileSync(join(process.env.HOME, "omms.log"), "utf8") : "";
    return { remote: remote.status, saved: saved.status, savedBody, config, fileText, mode,
      cleared: cleared.status, after, fileGone: !existsSync(file), log };
  `);
  expect(result.remote).toBe(403);
  expect(result.saved).toBe(200);
  expect(result.savedBody).not.toContain("browser-secret-value");
  expect(result.config.webServerAuthPassword).toMatch(/^file:\/\/.+\.key$/);
  expect(result.config.webServerAuthUsername).toBe("me");
  expect(result.fileText).toBe("browser-secret-value");
  if (process.platform !== "win32") expect(result.mode).toBe(0o600);
  expect(result.cleared).toBe(200);
  expect(result.after.webServerAuthPassword).toBeUndefined();
  expect(result.fileGone).toBe(true);
  expect(result.log).not.toContain("browser-secret-value");
});
