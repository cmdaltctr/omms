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
  const home = mkdtempSync(join(tmpdir(), "omms-update-"));
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

describe("POST /api/web/update", () => {
  it("guards the route like Restart and starts one install", async () => {
    const { result, log } = await runScenario(`
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
const post = async (address, headers) =>
  (await call(server, address, "POST", "/api/web/update", headers)).status;
result.noUpdater = await post("127.0.0.1");
let available = null;
let installs = 0;
let running = false;
server.setWebUpdate({
  status: () => ({ available, state: running ? "installing" : "idle", code: null, canInstall: true }),
  requestInstall: () => {
    if (running) return "accepted";
    if (!available) return "no-update";
    running = true;
    installs++;
    return "accepted";
  },
});
result.noToken = await post("127.0.0.1", {});
result.remote = await post("10.0.0.5");
result.noUpdate = await post("127.0.0.1");
available = "99.0.0";
result.first = await post("127.0.0.1");
result.second = await post("::ffff:127.0.0.1");
result.installs = installs;
`);
    expect(result.noUpdater).toBe(409);
    expect(result.noToken).toBe(401);
    expect(result.remote).toBe(403);
    expect(result.noUpdate).toBe(409);
    expect(result.first).toBe(202);
    expect(result.second).toBe(202);
    expect(result.installs).toBe(1);
    expect(log).toContain('"outcome":"refused_not_loopback"');
    expect(log).not.toContain(result.token ?? "no-token");
  });

  it("refuses with 409 when no npm sits beside Node.js", async () => {
    const { result } = await runScenario(`
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
server.setWebUpdate({
  status: () => ({ available: "99.0.0", state: "idle", code: null, canInstall: false }),
  requestInstall: () => "cannot-install",
});
result.status = (await call(server, "127.0.0.1", "POST", "/api/web/update")).status;
`);
    expect(result.status).toBe(409);
  });
});
