import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

setDefaultTimeout(30_000);

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const src = (file: string) => pathToFileURL(join(import.meta.dir, "../src/services", file)).href;

/** Run a scenario in a child process with a temp HOME, because the API token lives under HOME. */
async function runScenario(body: string) {
  const home = mkdtempSync(join(tmpdir(), "omms-power-"));
  tempDirs.push(home);
  const script = join(home, "scenario.mjs");
  const logFile = join(home, "omms.log");
  writeFileSync(
    script,
    `
const { WebServer } = await import(${JSON.stringify(src("web-server.js"))});
const { getOrCreateAuthToken } = await import(${JSON.stringify(src("auth-token.js"))});
const { packageVersion } = await import(${JSON.stringify(src("package-version.js"))});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const token = getOrCreateAuthToken();
const own = packageVersion();
const call = (server, address, method, path, headers = { "x-omms-token": token }) =>
  server.handleRequest(
    new Request("http://127.0.0.1:4747" + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(method === "POST" ? { body: "{}" } : {}),
    }),
    address
  );
const result = {};
${body}
console.log("SCENARIO_RESULT:" + JSON.stringify({ result, token }));
process.exit(0);
`
  );
  const proc = Bun.spawn(["bun", "run", script], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: logFile,
      OMMS_DISABLE_AUTO_BACKFILL: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const match = text.match(/SCENARIO_RESULT:(.*)$/m);
  if (!match) throw new Error(`no result:\n${text}\n${await new Response(proc.stderr).text()}`);
  const parsed = JSON.parse(match[1]!) as { result: Record<string, any>; token: string };
  let log = "";
  try {
    log = readFileSync(logFile, "utf8");
  } catch {
    /* No log written. */
  }
  return { ...parsed, log };
}

describe("GET /api/web/status", () => {
  it("reports the version, and control only for a loopback caller with a power callback", async () => {
    const { result } = await runScenario(`
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
const read = async (address, headers) => {
  const reply = await call(server, address, "GET", "/api/web/status", headers);
  return { status: reply.status, body: reply.status === 200 ? await reply.json() : null };
};
result.noCallback = await read("127.0.0.1");
server.setOnPowerAction(() => {});
result.loopback = await read("127.0.0.1");
result.mapped = await read("::ffff:127.0.0.1");
result.remote = await read("10.0.0.5");
result.noToken = (await read("127.0.0.1", {})).status;
result.own = own;
`);
    expect(result.noCallback).toEqual({
      status: 200,
      body: { version: result.own, canControl: false },
    });
    expect(result.loopback.body).toEqual({ version: result.own, canControl: true });
    expect(result.mapped.body.canControl).toBe(true);
    expect(result.remote).toEqual({
      status: 200,
      body: { version: result.own, canControl: false },
    });
    expect(result.noToken).toBe(401);
  });
});

describe("POST /api/web/stop and /api/web/restart", () => {
  it("runs the callback after the reply for a loopback caller with the token", async () => {
    const { result } = await runScenario(`
const actions = [];
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setOnPowerAction((action) => { actions.push(action); });
const stop = await call(server, "127.0.0.1", "POST", "/api/web/stop");
result.stop = stop.status;
result.atReply = actions.length;
await sleep(400);
result.afterStop = [...actions];
const restart = await call(server, "127.0.0.1", "POST", "/api/web/restart");
result.restart = restart.status;
await sleep(400);
result.afterRestart = [...actions];
`);
    expect(result.stop).toBe(202);
    expect(result.atReply).toBe(0);
    expect(result.afterStop).toEqual(["stop"]);
    expect(result.restart).toBe(202);
    expect(result.afterRestart).toEqual(["stop", "restart"]);
  });

  it("refuses without the token, from a non-loopback address, and without a callback", async () => {
    const { result } = await runScenario(`
const actions = [];
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
const bare = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setOnPowerAction((action) => { actions.push(action); });
for (const path of ["/api/web/stop", "/api/web/restart"]) {
  result[path] = {
    noToken: (await call(server, "127.0.0.1", "POST", path, {})).status,
    badToken: (await call(server, "127.0.0.1", "POST", path, { "x-omms-token": "nope" })).status,
    remote: (await call(server, "10.0.0.5", "POST", path)).status,
    noAddress: (await call(server, undefined, "POST", path)).status,
    noCallback: (await call(bare, "127.0.0.1", "POST", path)).status,
    get: (await call(server, "127.0.0.1", "GET", path)).status,
  };
}
await sleep(400);
result.actions = actions;
`);
    for (const path of ["/api/web/stop", "/api/web/restart"]) {
      expect(result[path]).toEqual({
        noToken: 401,
        badToken: 401,
        remote: 403,
        noAddress: 403,
        noCallback: 409,
        get: expect.any(Number),
      });
    }
    expect(result.actions).toEqual([]);
  });

  it("logs one record per request with the outcome and never the token", async () => {
    const { token, log } = await runScenario(`
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
const bare = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setOnPowerAction(() => {});
await call(server, "127.0.0.1", "POST", "/api/web/stop", {});
await call(server, "10.0.0.5", "POST", "/api/web/stop");
await call(bare, "127.0.0.1", "POST", "/api/web/restart");
await call(server, "127.0.0.1", "POST", "/api/web/restart");
await call(server, "127.0.0.1", "POST", "/api/web/stop");
await sleep(400);
`);
    const records = log.split("\n").filter((line) => line.includes("Web server power request"));
    expect(records).toHaveLength(5);
    for (const outcome of [
      "refused_auth",
      "refused_not_loopback",
      "unsupported",
      "restarting",
      "stopping",
    ]) {
      expect(records.filter((line) => line.includes(outcome))).toHaveLength(1);
    }
    expect(log).not.toContain(token);
  });
});

describe("start lock at ownership", () => {
  it("removes a start lock that names this process once the server owns the port", async () => {
    const { result } = await runScenario(`
const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");
const lock = join(process.env.HOME, ".omms", "web-start.lock");
mkdirSync(join(process.env.HOME, ".omms"), { recursive: true });
writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48831 });
await server.start();
await sleep(300);
result.owner = server.isServerOwner();
result.lockLeft = existsSync(lock);
await server.stop();
`);
    expect(result.owner).toBe(true);
    expect(result.lockLeft).toBe(false);
  });

  it("leaves a start lock that names another process", async () => {
    const { result } = await runScenario(`
const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");
const lock = join(process.env.HOME, ".omms", "web-start.lock");
mkdirSync(join(process.env.HOME, ".omms"), { recursive: true });
writeFileSync(lock, JSON.stringify({ pid: process.pid + 1, at: Date.now() }));
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48832 });
await server.start();
await sleep(300);
result.lockLeft = existsSync(lock);
await server.stop();
`);
    expect(result.lockLeft).toBe(true);
  });
});
