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
  const home = mkdtempSync(join(tmpdir(), "omms-step-aside-"));
  tempDirs.push(home);
  const script = join(home, "scenario.mjs");
  const logFile = join(home, "omms.log");
  writeFileSync(
    script,
    `
const { WebServer } = await import(${JSON.stringify(src("web-server.js"))});
const { getOrCreateAuthToken } = await import(${JSON.stringify(src("auth-token.js"))});
const { packageVersion } = await import(${JSON.stringify(src("package-version.js"))});
const { jest } = await import("bun:test");
const realSetTimeout = globalThis.setTimeout;
const waitFor = async (check, label) => {
  const deadline = performance.now() + 15000;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
};
// Keep socket and database shutdown real; control only the subsequent hold-off.
const controlHoldOff = (server) => {
  const stop = server.stop.bind(server);
  server.stop = async () => {
    await stop();
    jest.useFakeTimers();
    server.stop = stop;
  };
};
const token = getOrCreateAuthToken();
const own = packageVersion();
const stepAside = (server, address, version, headers = { "x-omms-token": token }) =>
  server.handleRequest(
    new Request("http://127.0.0.1:4747/api/web/step-aside", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ version }),
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
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 25_000,
  });
  const [text, error, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(exitCode, text + error).toBe(0);
  const match = text.match(/SCENARIO_RESULT:(.*)$/m);
  if (!match) throw new Error(`no result:\n${text}\n${error}`);
  const parsed = JSON.parse(match[1]!) as { result: Record<string, any>; token: string };
  let log = "";
  try {
    log = readFileSync(logFile, "utf8");
  } catch {
    /* No log written. */
  }
  return { ...parsed, log };
}

describe("POST /api/web/step-aside", () => {
  it("accepts a newer caller on loopback and refuses everything else", async () => {
    const { result } = await runScenario(`
jest.useFakeTimers();
let stepped = 0;
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setOnStepAside(() => { stepped += 1; });
result.noToken = (await stepAside(server, "127.0.0.1", "99.0.0", {})).status;
result.badToken = (await stepAside(server, "127.0.0.1", "99.0.0", { "x-omms-token": "nope" })).status;
result.remote = (await stepAside(server, "10.0.0.5", "99.0.0")).status;
result.noAddress = (await stepAside(server, undefined, "99.0.0")).status;
result.same = (await stepAside(server, "127.0.0.1", own)).status;
result.older = (await stepAside(server, "127.0.0.1", "0.0.1")).status;
result.unknown = (await stepAside(server, "127.0.0.1", "unknown")).status;
jest.advanceTimersByTime(400);
result.steppedAfterRefusals = stepped;
const accepted = await stepAside(server, "::ffff:127.0.0.1", "99.0.0");
result.accepted = accepted.status;
result.steppedAtReply = stepped;
jest.advanceTimersByTime(99);
result.steppedBeforeGrace = stepped;
jest.advanceTimersByTime(1);
result.steppedAfterReply = stepped;
jest.useRealTimers();
`);
    expect(result.noToken).toBe(401);
    expect(result.badToken).toBe(401);
    expect(result.remote).toBe(403);
    expect(result.noAddress).toBe(403);
    expect(result.same).toBe(409);
    expect(result.older).toBe(409);
    expect(result.unknown).toBe(409);
    expect(result.steppedAfterRefusals).toBe(0);
    expect(result.accepted).toBe(202);
    expect(result.steppedAtReply).toBe(0);
    expect(result.steppedBeforeGrace).toBe(0);
    expect(result.steppedAfterReply).toBe(1);
  });

  it("accepts a replace request of any version only with the token on loopback", async () => {
    const { result, log } = await runScenario(`
jest.useFakeTimers();
let stepped = 0;
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setOnStepAside(() => { stepped += 1; });
const replace = (address, version, headers = { "x-omms-token": token }) =>
  server.handleRequest(
    new Request("http://127.0.0.1:4747/api/web/step-aside", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ version, replace: true }),
    }),
    address
  );
result.noToken = (await replace("127.0.0.1", own, {})).status;
result.remote = (await replace("10.0.0.5", own)).status;
result.plainSame = (await stepAside(server, "127.0.0.1", own)).status;
jest.advanceTimersByTime(400);
result.steppedAfterRefusals = stepped;
result.sameVersion = (await replace("127.0.0.1", own)).status;
jest.advanceTimersByTime(400);
result.steppedAfterSame = stepped;
result.olderVersion = (await replace("127.0.0.1", "0.0.1")).status;
jest.useRealTimers();
`);
    expect(result.noToken).toBe(401);
    expect(result.remote).toBe(403);
    expect(result.plainSame).toBe(409);
    expect(result.steppedAfterRefusals).toBe(0);
    expect(result.sameVersion).toBe(202);
    expect(result.steppedAfterSame).toBe(1);
    expect(result.olderVersion).toBe(202);
    expect(log).toContain('"replace":true');
  });

  it("accepts a real request over the loopback socket", async () => {
    const { result } = await runScenario(`
let stepped = 0;
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48811 });
server.setOnStepAside(() => { stepped += 1; });
await server.start();
const send = (headers) => fetch("http://127.0.0.1:48811/api/web/step-aside", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ version: "99.0.0" }),
});
result.noToken = (await send({})).status;
result.accepted = (await send({ "x-omms-token": token })).status;
await waitFor(() => stepped === 1, "step-aside callback");
result.stepped = stepped;
await server.stop();
`);
    expect(result.noToken).toBe(401);
    expect(result.accepted).toBe(202);
    expect(result.stepped).toBe(1);
  });
});

describe("stepping aside without a callback", () => {
  it("stops serving, keeps the process alive, and waits before taking the port back", async () => {
    const { result } = await runScenario(`
const server = new WebServer({
  enabled: true, host: "127.0.0.1", port: 48812, stepAsideHoldOffMs: 1500,
});
await server.start();
controlHoldOff(server);
result.ownerBefore = server.isServerOwner();
const reply = await fetch("http://127.0.0.1:48812/api/web/step-aside", {
  method: "POST",
  headers: { "content-type": "application/json", "x-omms-token": token },
  body: JSON.stringify({ version: "99.0.0" }),
});
result.status = reply.status;
await waitFor(() => server.holdOffTimer !== null, "completed shutdown and hold-off timer");
result.ownerAfter = server.isServerOwner();
result.running = server.isRunning();
result.answers = await server.checkServerAvailable();
jest.advanceTimersByTime(1499);
result.loopEarly = server.healthCheckInterval !== null;
jest.advanceTimersByTime(1);
result.loopLate = server.healthCheckInterval !== null;
await server.stop();
result.loopAfterStop = server.healthCheckInterval !== null;
jest.useRealTimers();
`);
    expect(result.ownerBefore).toBe(true);
    expect(result.status).toBe(202);
    expect(result.ownerAfter).toBe(false);
    expect(result.running).toBe(false);
    expect(result.answers).toBe(false);
    expect(result.loopEarly).toBe(false);
    expect(result.loopLate).toBe(true);
    expect(result.loopAfterStop).toBe(false);
  });

  it("keeps a host process alive after it steps aside", async () => {
    const { result } = await runScenario(`
let exited = false;
process.on("exit", () => { exited = true; });
let beats = 0;
const heartbeat = setInterval(() => { beats += 1; }, 50);
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48814 });
await server.start();
await fetch("http://127.0.0.1:48814/api/web/step-aside", {
  method: "POST",
  headers: { "content-type": "application/json", "x-omms-token": token },
  body: JSON.stringify({ version: "99.0.0" }),
});
await waitFor(() => server.holdOffTimer !== null, "host shutdown");
const beatsAtStepAside = beats;
await waitFor(() => beats > beatsAtStepAside, "host heartbeat after shutdown");
result.exited = exited;
result.stillBeating = beats > beatsAtStepAside;
clearInterval(heartbeat);
await server.stop();
`);
    expect(result.exited).toBe(false);
    expect(result.stillBeating).toBe(true);
  });

  it("uses a 60 second hold-off by default", async () => {
    const { result } = await runScenario(`
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48813 });
await server.start();
controlHoldOff(server);
await fetch("http://127.0.0.1:48813/api/web/step-aside", {
  method: "POST",
  headers: { "content-type": "application/json", "x-omms-token": token },
  body: JSON.stringify({ version: "99.0.0" }),
});
await waitFor(() => server.holdOffTimer !== null, "default hold-off timer");
result.owner = server.isServerOwner();
jest.advanceTimersByTime(59999);
result.loop = server.healthCheckInterval !== null;
jest.advanceTimersByTime(1);
result.loopAfterMinute = server.healthCheckInterval !== null;
await server.stop();
jest.useRealTimers();
`);
    expect(result.owner).toBe(false);
    expect(result.loop).toBe(false);
    expect(result.loopAfterMinute).toBe(true);
  });
});

describe("step-aside log record", () => {
  it("logs each outcome with versions and never the token", async () => {
    const { token, log } = await runScenario(`
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setOnStepAside(() => {});
await stepAside(server, "127.0.0.1", "99.0.0", {});
await stepAside(server, "127.0.0.1", own);
await stepAside(server, "127.0.0.1", "99.0.0");
`);
    expect(log).toContain("refused_auth");
    expect(log).toContain("refused_not_newer");
    expect(log).toContain("stepped_aside");
    expect(log).toContain("99.0.0");
    expect(log).not.toContain(token);
  });
});
