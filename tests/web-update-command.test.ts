import { expect, it } from "bun:test";
import { runWebUpdate, type WebUpdateCommandDeps } from "../src/cli/web-update-command.js";

// `web update` against a fake port. Each web app answers health and status, and
// steps aside when its rules allow. Starting a web app puts it on the port at
// the next poll, after the old owner has left.

interface App {
  instance: string;
  version: string | null;
  /** False for a web app before the `replace` flag: it steps aside only for a newer caller. */
  knowsReplace?: boolean;
  /** True when it never steps aside, such as OMMS 3.5.0. */
  noRoute?: boolean;
  /** Requests it still answers after it agreed to step aside. */
  leaving?: number;
}

function olderThan(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number)) as [number[], number[]];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return false;
}

function fake(
  config: {
    latest?: string | null;
    global?: string | null;
    globalAfter?: string | null;
    installCode?: string | null;
    owner?: App | null;
    /** A web app that waits and takes the port before the fresh one. */
    waiter?: App;
    loginItem?: boolean;
    loginRestartWorks?: boolean;
    canStartDetached?: boolean;
    /** False when the fresh web app never answers. */
    freshAnswers?: boolean;
  } = {}
) {
  let port: App | null = config.owner === undefined ? null : config.owner;
  let global = config.global === undefined ? "4.4.1" : config.global;
  let pendingFresh: App | null = null;
  let waiter = config.waiter ?? null;
  let clock = 0;
  const events: string[] = [];
  const lines: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const stepAsides: { instance: string; replace: boolean }[] = [];

  const fetchFn = (async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    // A web app that agreed to step aside answers briefly before it stops.
    if (port?.leaving !== undefined && port.leaving-- <= 0) port = null;
    // A free port lets a waiter in first, then the fresh web app.
    if (!port && waiter) [port, waiter] = [waiter, null];
    else if (!port && pendingFresh) [port, pendingFresh] = [pendingFresh, null];
    if (!port) throw new Error("ECONNREFUSED");
    if (path === "/api/health") return Response.json({ instance: port.instance });
    if (path === "/api/web/status") return Response.json({ version: port.version });
    if (path === "/api/web/step-aside") {
      const body = JSON.parse(String(init?.body)) as { version: string; replace?: boolean };
      stepAsides.push({ instance: port.instance, replace: body.replace === true });
      const allowed =
        !port.noRoute &&
        ((body.replace && port.knowsReplace !== false) ||
          (port.version !== null && olderThan(port.version, body.version)));
      if (!allowed) return new Response("{}", { status: 409 });
      events.push(`aside:${port.instance}`);
      port.leaving = 2;
      return new Response("{}", { status: 202 });
    }
    throw new Error(`unexpected ${path}`);
  }) as unknown as typeof fetch;

  const startFresh = () => {
    // The launcher runs the newest copy: the global install or the copy this command runs as.
    const newest = global && olderThan("4.10.0", global) ? global : "4.10.0";
    if (config.freshAnswers !== false) pendingFresh = { instance: "fresh", version: newest };
  };
  const deps: WebUpdateCommandDeps = {
    url: "http://127.0.0.1:4747",
    headers: { "x-omms-token": "secret-token" },
    version: "4.10.0",
    fetchFn,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    latest: async () => (config.latest === undefined ? "4.10.0" : config.latest),
    globalVersion: () => global,
    install: async (target) => {
      events.push(`npm:${target}`);
      if (config.installCode) return { code: config.installCode, exitCode: 1 };
      global = config.globalAfter === undefined ? target : config.globalAfter;
      return { code: null, exitCode: 0 };
    },
    loginItemInstalled: () => config.loginItem ?? false,
    restartLoginItem: () => {
      events.push("login-item");
      if (config.loginRestartWorks === false) return false;
      startFresh();
      return true;
    },
    startDetached: () => {
      events.push("launcher");
      if (config.canStartDetached === false) return false;
      startFresh();
      return true;
    },
    writeStartLock: () => events.push("lock"),
    removeStartLock: () => events.push("unlock"),
    writeRetireMarker: (before) => events.push(`retire:${before}`),
    print: (line) => lines.push(line),
    log: (_message, data) => logs.push(data),
  };
  return {
    deps,
    events,
    lines,
    logs,
    stepAsides,
    port: () => port,
    global: () => global,
  };
}

const app = (instance: string, version: string | null, extra: Partial<App> = {}): App => ({
  instance,
  version,
  ...extra,
});

it("updates an older global install and replaces a same-version web app", async () => {
  const f = fake({ owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.global()).toBe("4.10.0");
  expect(f.events).toEqual(["npm:4.10.0", "lock", "retire:0", "aside:old", "launcher", "unlock"]);
  expect(f.port()?.instance).toBe("fresh");
  expect(f.lines.at(-1)).toBe("OMMS web app: http://127.0.0.1:4747 (version 4.10.0)");
});

it("installs when there is no global install", async () => {
  const f = fake({ global: null });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.events[0]).toBe("npm:4.10.0");
});

it("skips npm when the global install is on latest and still replaces the web app", async () => {
  const f = fake({ global: "4.10.0", owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.events.some((e) => e.startsWith("npm:"))).toBe(false);
  expect(f.events).toContain("aside:old");
  expect(f.port()?.instance).toBe("fresh");
});

it("skips npm when the registry does not answer and continues", async () => {
  const f = fake({ latest: null, owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.events.some((e) => e.startsWith("npm:"))).toBe(false);
  expect(f.lines[0]).toContain("Could not check npm");
  expect(f.port()?.instance).toBe("fresh");
});

it("leaves the web app alone when npm fails", async () => {
  const f = fake({ installCode: "permission", owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(1);
  expect(f.events).toEqual(["npm:4.10.0"]);
  expect(f.port()?.instance).toBe("old");
  expect(f.lines.at(-1)).toContain("(permission)");
});

it("leaves the web app alone when npm leaves another version", async () => {
  const f = fake({ globalAfter: "4.4.1", owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(1);
  expect(f.port()?.instance).toBe("old");
  expect(f.lines.at(-1)).toContain("(version-mismatch)");
});

it("starts a web app when none runs", async () => {
  const f = fake({ owner: null });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.stepAsides).toHaveLength(0);
  expect(f.port()?.instance).toBe("fresh");
});

it("replaces an older web app that predates the replace flag", async () => {
  const f = fake({ owner: app("old", "4.9.0", { knowsReplace: false }) });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.stepAsides).toEqual([{ instance: "old", replace: true }]);
  expect(f.port()?.instance).toBe("fresh");
});

it("reports a same-version web app that predates the replace flag", async () => {
  const f = fake({ owner: app("old", "4.10.0", { knowsReplace: false }) });
  expect(await runWebUpdate(f.deps)).toBe(1);
  expect(f.events).not.toContain("launcher");
  expect(f.lines.at(-1)).toContain("OMMS 4.10.0 holds");
});

it("reports a web app that cannot step aside, and starts nothing", async () => {
  const f = fake({ owner: app("old", "3.5.0", { noRoute: true }) });
  expect(await runWebUpdate(f.deps)).toBe(1);
  expect(f.events).not.toContain("launcher");
  expect(f.events.at(-1)).toBe("unlock");
  expect(f.lines.at(-1)).toContain("OMMS 3.5.0 holds http://127.0.0.1:4747");
  expect(f.lines.at(-1)).toContain("Stop in its power menu");
});

it("restarts the login item when it is installed", async () => {
  const f = fake({ loginItem: true, owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.events).toContain("login-item");
  expect(f.events).not.toContain("launcher");
});

it("starts through the launcher when the login item restart fails", async () => {
  const f = fake({ loginItem: true, loginRestartWorks: false, owner: app("old", "4.10.0") });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.events).toContain("launcher");
});

it("fails when there is no copy to start", async () => {
  const f = fake({ canStartDetached: false });
  expect(await runWebUpdate(f.deps)).toBe(1);
  expect(f.events.at(-1)).toBe("unlock");
});

it("fails after 15 seconds when no web app answers", async () => {
  const f = fake({ owner: app("old", "4.10.0"), freshAnswers: false });
  expect(await runWebUpdate(f.deps)).toBe(1);
  expect(f.lines.at(-1)).toContain("within 15 seconds");
  expect(f.events.at(-1)).toBe("unlock");
});

it("asks an older waiting web app that took the port to step aside", async () => {
  const f = fake({ owner: app("old", "4.10.0"), waiter: app("waiter", "4.9.0") });
  expect(await runWebUpdate(f.deps)).toBe(0);
  expect(f.events).toContain("aside:waiter");
  expect(f.port()?.instance).toBe("fresh");
});

it("logs codes and versions, never the token or npm output", async () => {
  const f = fake({ installCode: "network" });
  await runWebUpdate(f.deps);
  const ok = fake({ owner: app("old", "4.10.0") });
  await runWebUpdate(ok.deps);
  expect(f.logs[0]).toMatchObject({ outcome: "install-failed", code: "network", npm: "ran" });
  expect(ok.logs[0]).toMatchObject({
    outcome: "replaced",
    code: null,
    latest: "4.10.0",
    globalBefore: "4.4.1",
    globalAfter: "4.10.0",
    served: "4.10.0",
    start: "launcher",
  });
  expect(typeof ok.logs[0]!.durationMs).toBe("number");
  expect(JSON.stringify([...f.logs, ...ok.logs])).not.toContain("secret-token");
});
