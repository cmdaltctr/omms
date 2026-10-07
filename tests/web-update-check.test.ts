import { expect, it } from "bun:test";
import {
  UPDATE_CHECK_INTERVAL_MS,
  WebUpdate,
  type WebUpdateDeps,
} from "../src/services/web-update.js";

/** A web app at `version` whose npm reads answer from `latest` in turn. */
function fake(version: string, latest: (string | null)[], enabled = true) {
  const requests: string[] = [];
  const clock = { ms: 0 };
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  const timers: { ms: number; callback: () => void }[] = [];
  const deps: WebUpdateDeps = {
    version,
    enabled,
    fetch: (async (url: string) => {
      requests.push(url);
      const next = latest.shift();
      if (next === null || next === undefined) throw new Error("offline");
      return new Response(JSON.stringify({ version: next }), { status: 200 });
    }) as unknown as typeof fetch,
    setInterval: (callback, ms) => {
      timers.push({ ms, callback });
      return {};
    },
    log: (message, data) => logs.push({ message, data }),
    execPath: "/opt/node/bin/node",
    platform: "darwin",
    exists: () => true,
    spawn: () => {
      throw new Error("no install in check tests");
    },
    globalVersion: () => null,
    restart: async () => undefined,
    canRestart: () => true,
    killTree: async () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: () => clock.ms,
  };
  return { update: new WebUpdate(deps), requests, logs, timers, clock };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("reports a newer release from npm", async () => {
  const f = fake("4.9.0", ["4.10.0"]);
  f.update.start();
  await settle();
  expect(f.update.status().available).toBe("4.10.0");
  expect(f.requests).toEqual(["https://registry.npmjs.org/om-memory-system/latest"]);
});

it("reports no update for the same release", async () => {
  const f = fake("4.9.0", ["4.9.0"]);
  await f.update.check();
  expect(f.update.status().available).toBeNull();
});

it("ignores a prerelease", async () => {
  const f = fake("4.9.0", ["5.0.0-beta.1"]);
  await f.update.check();
  expect(f.update.status().available).toBeNull();
});

it("checks again every 10 minutes", async () => {
  const f = fake("4.9.0", ["4.9.0", "4.10.0"]);
  f.update.start();
  f.update.start();
  await settle();
  expect(f.timers.map((timer) => timer.ms)).toEqual([UPDATE_CHECK_INTERVAL_MS]);
  expect(UPDATE_CHECK_INTERVAL_MS).toBe(10 * 60 * 1000);
  expect(f.update.status().available).toBeNull();
  f.timers[0]!.callback();
  await settle();
  expect(f.update.status().available).toBe("4.10.0");
});

it("sends no request when the check is turned off", async () => {
  const f = fake("4.9.0", ["4.10.0"], false);
  f.update.start();
  await f.update.check();
  expect(f.requests).toEqual([]);
  expect(f.timers).toEqual([]);
  expect(f.update.status().available).toBeNull();
});

it("keeps the last result and logs a code when npm cannot be reached", async () => {
  const f = fake("4.9.0", ["4.10.0", null]);
  await f.update.check();
  await f.update.check();
  expect(f.update.status().available).toBe("4.10.0");
  expect(f.logs).toEqual([
    { message: "Web app update check failed", data: { code: "unreachable" } },
  ]);
});

it("checks again when the page reads the status and the last check is over a minute old", async () => {
  const f = fake("4.12.0", ["4.12.0", "4.13.0"]);
  f.update.start();
  await settle();
  expect(f.update.status().available).toBeNull();
  expect(f.requests).toHaveLength(1);
  f.clock.ms = 30_000;
  f.update.status();
  await settle();
  expect(f.requests).toHaveLength(1);
  f.clock.ms = 61_000;
  f.update.status();
  await settle();
  expect(f.requests).toHaveLength(2);
  expect(f.update.status().available).toBe("4.13.0");
});

it("sends one request when the page reads the status twice during a check", async () => {
  const f = fake("4.12.0", ["4.12.0", "4.13.0", "4.14.0"]);
  await f.update.check();
  f.clock.ms = 61_000;
  f.update.status();
  f.update.status();
  await settle();
  expect(f.requests).toHaveLength(2);
});

it("reads no npm version from the status when the check is turned off", async () => {
  const f = fake("4.12.0", ["4.13.0"], false);
  f.clock.ms = 120_000;
  f.update.status();
  await settle();
  expect(f.requests).toEqual([]);
});
