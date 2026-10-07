import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A package folder with a launcher, so the login item can be installed.
const repoRoot = join(import.meta.dir, "..");

it("manages a temp login item and saves the matching global switch", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-web-command-"));
  try {
    const script = join(home, "scenario.mjs");
    const commandUrl = new URL("../src/cli/web-command.js", import.meta.url).href;
    writeFileSync(
      script,
      `
const { readFileSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { runWebCommand } = await import(${JSON.stringify(commandUrl)});
const home = ${JSON.stringify(home)};
const commands = [];
const options = { home, platform: "darwin", runtime: "/opt/node",
  packageRoot: ${JSON.stringify(repoRoot)}, run: (command, args) => commands.push([command, ...args].join(" ")) };
const offline = { fetch: async () => { throw new Error("offline"); }, sleep: async () => {} };
const install = await runWebCommand(["install"], options, async () => false, offline);
const path = join(home, ".config", "omms", "omms.jsonc");
const installedConfig = readFileSync(path, "utf8");
const status = await runWebCommand(["status"], options, async () => false);
const uninstall = await runWebCommand(["uninstall"], options, async () => false);
const uninstalledConfig = readFileSync(path, "utf8");
writeFileSync(path, '{ "webServerHost": "::1" }');
const ipv6Status = await runWebCommand(["status"], options, async () => false);
writeFileSync(path, '{ "webServerEnabled": false }');
const refused = await runWebCommand([], options, async () => false);
const disabledInstall = await runWebCommand(["install"], options, async () => false);
const disabledUpdate = await runWebCommand(["update"], options, async () => false);
const disabledConfig = readFileSync(path, "utf8");
const bogus = await runWebCommand(["bogus"], options, async () => false);
writeFileSync(path, "{}");
let clock = 0;
const routedUpdate = await runWebCommand(["update"], options, async () => false, {}, {
  fetchFn: async () => { throw new Error("offline"); },
  latest: async () => null,
  sleep: async (ms) => { clock += ms; },
  now: () => clock,
  loginItemInstalled: () => false,
  startDetached: () => true,
  writeStartLock: () => {},
  removeStartLock: () => {},
  writeRetireMarker: () => {},
  log: () => {},
});
console.log("RESULT:" + JSON.stringify({ install, status, uninstall, refused, disabledInstall,
  disabledUpdate, bogus, routedUpdate, disabledConfig, installedConfig, uninstalledConfig, commands }));
`
    );
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    const text = child.stdout.toString();
    const match = text.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${text}\n${child.stderr.toString()}`);
    const out = JSON.parse(match[1]);
    expect([out.install, out.status, out.uninstall, out.refused, out.disabledInstall]).toEqual([
      0, 0, 0, 1, 1,
    ]);
    expect([out.disabledUpdate, out.bogus, out.routedUpdate]).toEqual([1, 1, 1]);
    // `web`, `web install`, and `web update` each refuse with the reason.
    expect(child.stderr.toString().match(/webServerEnabled is false/g)).toHaveLength(3);
    expect(child.stderr.toString()).toContain(
      "Usage: om-memory-system web [install|uninstall|status|update]"
    );
    expect(text).toContain("No web app answered on http://127.0.0.1:4747 within 15 seconds");
    expect(out.disabledConfig).toBe('{ "webServerEnabled": false }');
    expect(out.installedConfig).toContain('"webServerAutoStart": true');
    expect(out.uninstalledConfig).toContain('"webServerAutoStart": false');
    expect(out.commands.some((line: string) => line.includes("launchctl bootstrap"))).toBe(true);
    expect(text).toContain("OMMS web app: http://127.0.0.1:4747");
    expect(text).toContain('"url": "http://127.0.0.1:4747"');
    expect(text).toContain('"url": "http://[::1]:4747"');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

interface FakeOwner {
  version: string;
  /** Status the owner returns for the step-aside request. */
  stepAside: 202 | 404 | 409;
}

/** Run `web install` in a child process against a fake web app on the configured port. */
function runInstallAgainst(owner: FakeOwner | null) {
  const home = mkdtempSync(join(tmpdir(), "omms-web-handover-"));
  try {
    const script = join(home, "scenario.mjs");
    const commandUrl = new URL("../src/cli/web-command.js", import.meta.url).href;
    writeFileSync(
      script,
      `
const { runWebCommand } = await import(${JSON.stringify(commandUrl)});
const events = [];
const owner = ${JSON.stringify(owner)};
const state = { alive: Boolean(owner), version: owner?.version, dying: 0 };
const fakeFetch = async (input, init = {}) => {
  const path = new URL(String(input)).pathname;
  const method = init.method ?? "GET";
  if (path === "/api/web/step-aside") {
    const headers = init.headers ?? {};
    const token = headers["x-omms-token"] ?? headers["X-Omms-Token"];
    events.push("POST " + path + " token=" + (token ? "yes" : "no") + " body=" + init.body);
    if (owner.stepAside === 202) state.dying = 2;
    return new Response("{}", { status: owner.stepAside });
  }
  if (!state.alive) {
    if (path === "/api/health") events.push("health:free");
    throw new Error("ECONNREFUSED");
  }
  if (path === "/api/health") {
    if (state.dying && --state.dying === 0) state.alive = false;
    events.push("health:busy");
    return Response.json({ success: true, status: "ok" });
  }
  events.push(method + " " + path);
  return Response.json({ running: state.version, global: null, mismatch: false });
};
const options = { home: ${JSON.stringify(home)}, platform: "darwin", runtime: "/opt/node",
  packageRoot: ${JSON.stringify(repoRoot)}, run: (command, args) => {
    const line = "run: " + [command, ...args].join(" ");
    events.push(line);
    if (line.includes("bootstrap")) { state.alive = true; state.version = "3.6.0"; }
  } };
const code = await runWebCommand(["install"], options, async () => false,
  { fetch: fakeFetch, sleep: async () => {}, version: "3.6.0" });
console.log("RESULT:" + JSON.stringify({ code, events }));
`
    );
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    const text = child.stdout.toString();
    const match = text.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${text}\n${child.stderr.toString()}`);
    const out = JSON.parse(match[1]!) as { code: number; events: string[] };
    return { ...out, text: text.replace(/^RESULT:.*$/m, "") };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const indexOfEvent = (events: string[], part: string) =>
  events.findIndex((event) => event.includes(part));

it("asks an older web app to step aside and starts the item after the port is free", () => {
  const { code, events, text } = runInstallAgainst({ version: "3.5.0", stepAside: 202 });
  expect(code).toBe(0);
  const post = indexOfEvent(events, "POST /api/web/step-aside");
  const free = indexOfEvent(events, "health:free");
  const start = indexOfEvent(events, "launchctl bootstrap");
  expect(events[post]).toBe('POST /api/web/step-aside token=yes body={"version":"3.6.0"}');
  expect(post).toBeGreaterThan(-1);
  expect(free).toBeGreaterThan(post);
  expect(start).toBeGreaterThan(free);
  expect(indexOfEvent(events, "launchctl bootout")).toBeGreaterThan(free);
  expect(text).toContain("OMMS web app: http://127.0.0.1:4747 (version 3.6.0)");
});

it("says it cannot hand the port over when the older web app has no step-aside route", () => {
  const { code, events, text } = runInstallAgainst({ version: "3.5.0", stepAside: 404 });
  expect(code).toBe(0);
  expect(text).toContain("OMMS 3.5.0 holds port 4747 and cannot hand it over.");
  expect(text).toContain("om-memory-system web install");
  expect(indexOfEvent(events, "launchctl bootstrap")).toBeGreaterThan(-1);
});

it("leaves a web app of the same version running", () => {
  const { code, events, text } = runInstallAgainst({ version: "3.6.0", stepAside: 202 });
  expect(code).toBe(0);
  expect(indexOfEvent(events, "POST /api/web/step-aside")).toBe(-1);
  expect(text).toContain("OMMS web app: http://127.0.0.1:4747 (version 3.6.0)");
});

it("leaves a newer web app running and tells the user to update the command", () => {
  const { code, events, text } = runInstallAgainst({ version: "3.7.0", stepAside: 202 });
  expect(code).toBe(0);
  expect(indexOfEvent(events, "POST /api/web/step-aside")).toBe(-1);
  expect(text).toContain("OMMS 3.7.0 already serves port 4747.");
  expect(text).toContain("newer than this command (3.6.0)");
  expect(text).toContain("npm i -g om-memory-system");
});

it("installs as before when no web app holds the port", () => {
  const { code, events, text } = runInstallAgainst(null);
  expect(code).toBe(0);
  expect(indexOfEvent(events, "POST /api/web/step-aside")).toBe(-1);
  expect(indexOfEvent(events, "launchctl bootstrap")).toBeGreaterThan(-1);
  expect(text).toContain("OMMS web app: http://127.0.0.1:4747");
  expect(text).not.toContain("(version");
});
