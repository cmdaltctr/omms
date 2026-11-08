import { expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  AUTO_RETRY_AFTER_MS,
  STATUS_RECHECK_AFTER_MS,
  WebUpdate,
  type InstallChild,
  type WebUpdateDeps,
} from "../src/services/web-update.js";

// The automatic install: a check that finds a release starts the install the
// Update button starts, and an automatic failure waits 30 minutes before
// another automatic attempt. A manual requestInstall ignores that wait.

/** How the fake npm ends. */
type NpmEnd = { exit: number; stderr?: string } | { hang: true };

/** A web app 4.9.0 whose npm answers `latest` in turn and runs a fake npm. */
function fake(
  config: { latest?: (string | null)[]; npm?: NpmEnd; canRestart?: boolean; enabled?: boolean } = {}
) {
  const answers = config.latest ?? ["4.10.0"];
  const requests: string[] = [];
  const spawns: { command: string; args: string[] }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  const clock = { ms: 0 };
  const deps: WebUpdateDeps = {
    version: "4.9.0",
    enabled: config.enabled ?? true,
    fetch: (async (url: string) => {
      requests.push(url);
      // A single answer repeats; a list answers in turn.
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next === null || next === undefined) throw new Error("offline");
      return new Response(JSON.stringify({ version: next }), { status: 200 });
    }) as unknown as typeof fetch,
    setInterval: () => ({}),
    log: (message, data) => logs.push({ message, data }),
    execPath: "/opt/node/bin/node",
    pathEnv: "/usr/bin:/bin",
    platform: "darwin",
    exists: () => true,
    spawn: (command, args) => {
      spawns.push({ command, args });
      const npm = config.npm ?? { exit: 0 };
      const emitter = new EventEmitter();
      const stderr = new EventEmitter();
      const child = Object.assign(emitter, { stderr, kill: () => true }) as unknown as InstallChild;
      setTimeout(() => {
        if ("hang" in npm) return;
        if (npm.stderr) stderr.emit("data", Buffer.from(npm.stderr));
        emitter.emit("exit", npm.exit);
      }, 0);
      return child;
    },
    globalVersion: () => "4.10.0",
    restart: async () => undefined,
    canRestart: () => config.canRestart ?? true,
    killTree: async () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: () => clock.ms,
  };
  return { update: new WebUpdate(deps), requests, spawns, logs, clock };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

it("a check that finds a newer release starts the install by itself", async () => {
  const f = fake({ npm: { hang: true } });
  await f.update.check();
  expect(f.spawns).toEqual([
    { command: "/opt/node/bin/npm", args: ["install", "-g", "om-memory-system@4.10.0"] },
  ]);
  expect(f.update.status().state).toBe("installing");
});

it("starts nothing when the check is turned off", async () => {
  const f = fake({ enabled: false });
  f.update.start();
  await f.update.check();
  expect(f.requests).toEqual([]);
  expect(f.spawns).toEqual([]);
  expect(f.update.status().state).toBe("idle");
});

it("starts nothing when it cannot install, and still reports the release", async () => {
  const f = fake({ canRestart: false });
  await f.update.check();
  expect(f.spawns).toEqual([]);
  expect(f.update.status()).toMatchObject({
    available: "4.10.0",
    state: "idle",
    canInstall: false,
  });
});

it("waits 30 minutes after a failed automatic install; a manual install still starts", async () => {
  const f = fake({ npm: { exit: 1, stderr: "npm ERR! code EACCES secret-path" } });
  await f.update.check();
  await settle();
  expect(f.update.status()).toMatchObject({ state: "failed", code: "permission" });
  expect(AUTO_RETRY_AFTER_MS).toBe(30 * 60 * 1000);
  f.clock.ms = 5 * 60 * 1000;
  await f.update.check();
  await settle();
  expect(f.spawns).toHaveLength(1);
  expect(f.update.requestInstall()).toBe("accepted");
  expect(f.spawns).toHaveLength(2);
});

it("tries again automatically once the 30-minute window has passed", async () => {
  const f = fake({ npm: { exit: 1 } });
  await f.update.check();
  await settle();
  expect(f.spawns).toHaveLength(1);
  f.clock.ms = AUTO_RETRY_AFTER_MS + 1000;
  await f.update.check();
  await settle();
  expect(f.spawns).toHaveLength(2);
});

it("logs one record for the automatic start, with versions only", async () => {
  const f = fake({ npm: { exit: 0, stderr: "npm WARN noise secret-noise" } });
  await f.update.check();
  await settle();
  expect(f.logs.filter((entry) => entry.message === "Web app auto-update started")).toEqual([
    { message: "Web app auto-update started", data: { from: "4.9.0", to: "4.10.0" } },
  ]);
  expect(JSON.stringify(f.logs)).not.toContain("secret-noise");
});

it("a status read that triggers a fresh check also starts the automatic install", async () => {
  const f = fake({ latest: ["4.9.0", "4.10.0"], npm: { hang: true } });
  await f.update.check();
  expect(f.spawns).toEqual([]);
  f.clock.ms = STATUS_RECHECK_AFTER_MS + 1000;
  f.update.status();
  await settle();
  expect(f.spawns).toEqual([
    { command: "/opt/node/bin/npm", args: ["install", "-g", "om-memory-system@4.10.0"] },
  ]);
  expect(f.update.status().state).toBe("installing");
});
