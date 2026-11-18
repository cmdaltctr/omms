import { afterEach, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

setDefaultTimeout(30_000);

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

const src = (file: string) => pathToFileURL(join(import.meta.dir, "../src/services", file)).href;

// The web app runs the daily cleanup for Claude Code (ADR-051): start() starts the timer and
// stop() stops it. The timer module is replaced, so the test counts calls and deletes nothing.
it("starts the daily maintenance timer with the web app and stops it on stop()", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-maintenance-timer-"));
  homes.push(home);
  const script = join(home, "scenario.mjs");
  writeFileSync(
    script,
    `
const { mock } = await import("bun:test");
const calls = { started: 0, stopped: 0 };
let getConfig;
mock.module(${JSON.stringify(src("cleanup-service.js"))}, () => ({
  startDailyMaintenanceTimer: (getter) => {
    getConfig = getter;
    calls.started += 1;
    return () => { calls.stopped += 1; };
  },
}));
const { WebServer } = await import(${JSON.stringify(src("web-server.js"))});
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48871 });
await server.start();
const deadline = Date.now() + 10000;
while (calls.started === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
const afterStart = { ...calls };
// The timer gets a getter for the live CONFIG, so each tick reads the current settings.
const { CONFIG } = await import(${JSON.stringify(src("../config.js"))});
const readsLiveConfig = getConfig?.() === CONFIG;
await server.stop();
console.log("RESULT:" + JSON.stringify({ afterStart, afterStop: calls, readsLiveConfig }));
process.exit(0);
`
  );
  const proc = Bun.spawn(["bun", "run", script], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_SKIP_LEGACY_MIGRATION: "1",
      OMMS_DISABLE_WEB_AUTOSTART: "1",
    },
  });
  const output = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const result = JSON.parse(output.match(/RESULT:(.*)$/m)![1]!);
  expect(result.afterStart).toEqual({ started: 1, stopped: 0 });
  expect(result.afterStop).toEqual({ started: 1, stopped: 1 });
  expect(result.readsLiveConfig).toBe(true);
});
