import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureWebApp,
  nodeLockFs,
  renameRetrying,
  takeStartLock,
  type EnsureDeps,
  type EnsureResult,
  type LockFs,
} from "../src/services/web-ensure.js";

const BASE = "http://127.0.0.1:4747";
const LOCK = "/home/test/.omms/web-start.lock";
const SETTINGS = { enabled: true, baseUrl: BASE };

type Reply = "omms" | "other" | "down";

/**
 * A fake machine: one port, one lock file, and a clock that only moves when
 * something sleeps. `upAfterPolls` brings the web app up after a spawn.
 */
function world(
  config: {
    initial?: Reply;
    upAfterPolls?: number;
    runtime?: string | null;
    alive?: (pid: number) => boolean;
    lock?: { pid: number; at: number };
  } = {}
) {
  const clock = { t: 100_000 };
  const files = new Map<string, string>();
  if (config.lock) files.set(LOCK, JSON.stringify(config.lock));
  const spawns: { command: string; args: string[]; options: any; unref: number }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  let reply: Reply = config.initial ?? "down";
  let polls = -1;
  const deps: Partial<EnsureDeps> = {
    fetch: (async () => {
      if (polls >= 0) {
        polls++;
        if (config.upAfterPolls !== undefined && polls >= config.upAfterPolls) reply = "omms";
      }
      if (reply === "down") throw new TypeError("fetch failed");
      if (reply === "other") return Response.json({ hello: "world" });
      return Response.json({ success: true, status: "ok" });
    }) as unknown as typeof fetch,
    spawn: ((command: string, args: string[], options: any) => {
      const record = { command, args, options, unref: 0 };
      spawns.push(record);
      polls = 0;
      return { unref: () => record.unref++, on: () => undefined };
    }) as unknown as EnsureDeps["spawn"],
    sleep: async (ms) => {
      clock.t += ms;
      await Promise.resolve();
    },
    now: () => clock.t,
    resolveRuntime: async () => (config.runtime === undefined ? "/usr/bin/node" : config.runtime),
    cliScript: "/pkg/dist/cli/index.js",
    launcherScript: null,
    lockPath: LOCK,
    lockFs: {
      createExclusive: (path, text) => {
        if (files.has(path)) return false;
        files.set(path, text);
        return true;
      },
      read: (path) => files.get(path) ?? null,
      remove: (path) => void files.delete(path),
      link: (from, to) => {
        const text = files.get(from);
        if (text === undefined || files.has(to)) return false;
        files.set(to, text);
        return true;
      },
      ageMs: (path) => (files.has(path) ? 0 : null),
      replace: (path, text) => void files.set(path, text),
    },
    pidAlive: config.alive ?? (() => true),
    pid: 100,
    log: (message, data) => void logs.push({ message, data }),
  };
  return { deps, spawns, logs, files, clock };
}

describe("ensureWebApp", () => {
  it("uses a running OMMS web app and starts nothing", async () => {
    const w = world({ initial: "omms" });
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("running");
    expect(w.spawns).toHaveLength(0);
    expect(w.files.size).toBe(0);
  });

  it("starts nothing when webServerEnabled is false", async () => {
    const w = world();
    const result = await ensureWebApp({
      settings: { enabled: false, baseUrl: BASE },
      budgetMs: 5_000,
      deps: w.deps,
    });
    expect(result).toBe("disabled");
    expect(w.spawns).toHaveLength(0);
  });

  it("reports port-busy and starts nothing when another program answers", async () => {
    const w = world({ initial: "other" });
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("port-busy");
    expect(w.spawns).toHaveLength(0);
    expect(w.logs.some((entry) => entry.data.code === "port-busy")).toBe(true);
  });

  it("starts exactly one detached web app when nothing answers", async () => {
    const w = world({ upAfterPolls: 2 });
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("started");
    expect(w.spawns).toHaveLength(1);
    const [spawned] = w.spawns;
    expect(spawned?.command).toBe("/usr/bin/node");
    expect(spawned?.args).toEqual(["/pkg/dist/cli/index.js", "web"]);
    expect(spawned?.options).toMatchObject({ detached: true, stdio: "ignore" });
    expect(spawned?.unref).toBe(1);
    expect(w.files.size).toBe(0);
  });

  it("returns no-runtime and starts nothing when no runtime is found", async () => {
    const w = world({ runtime: null });
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("no-runtime");
    expect(w.spawns).toHaveLength(0);
    expect(w.files.size).toBe(0);
  });

  it("returns start-timeout when the web app never answers within the budget", async () => {
    const w = world();
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 2_000, deps: w.deps });
    expect(result).toBe("start-timeout");
    expect(w.spawns).toHaveLength(1);
    expect(w.clock.t - 100_000).toBeLessThanOrEqual(2_000);
    expect(w.files.size).toBe(0);
  });
});

describe("ensureWebApp start lock", () => {
  it("starts exactly one web app for ten parallel callers", async () => {
    const w = world({ upAfterPolls: 4 });
    const results: EnsureResult[] = await Promise.all(
      Array.from({ length: 10 }, () =>
        ensureWebApp({ settings: SETTINGS, budgetMs: 15_000, deps: w.deps })
      )
    );
    expect(w.spawns).toHaveLength(1);
    expect(results.filter((result) => result === "started")).toHaveLength(1);
    expect(results.filter((result) => result === "running")).toHaveLength(9);
    expect(w.files.size).toBe(0);
  });

  it("uses a web app that came up while the caller took the lock", async () => {
    const w = world();
    let probes = 0;
    w.deps.fetch = (async () => {
      probes++;
      if (probes < 2) throw new TypeError("fetch failed");
      return Response.json({ success: true, status: "ok" });
    }) as unknown as typeof fetch;
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("running");
    expect(w.spawns).toHaveLength(0);
    expect(w.files.size).toBe(0);
  });

  it("leaves a lock alone that another process took over during the start", async () => {
    const w = world({ upAfterPolls: 3 });
    const sleep = w.deps.sleep!;
    w.deps.sleep = async (ms) => {
      // Our lock went stale and another caller replaced it.
      w.files.set(LOCK, JSON.stringify({ pid: 555, at: w.clock.t }));
      await sleep(ms);
    };
    await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(JSON.parse(w.files.get(LOCK) ?? "null")).toMatchObject({ pid: 555 });
  });

  it("takes over a lock whose process is dead", async () => {
    const w = world({
      upAfterPolls: 1,
      lock: { pid: 999, at: 100_000 },
      alive: (pid) => pid !== 999,
    });
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("started");
    expect(w.spawns).toHaveLength(1);
  });

  it("takes over a lock older than 20 seconds", async () => {
    const w = world({ upAfterPolls: 1, lock: { pid: 999, at: 100_000 - 20_001 } });
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("started");
    expect(w.spawns).toHaveLength(1);
  });

  it("takes over a lock that cannot be read", async () => {
    const w = world({ upAfterPolls: 1 });
    w.files.set(LOCK, "not json");
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("started");
    expect(w.spawns).toHaveLength(1);
  });

  it("does not spawn without the lock, and returns once health answers", async () => {
    const w = world({ lock: { pid: 999, at: 100_000 - 1_000 } });
    // Another caller started a web app just now; health comes up after a few probes.
    let probes = 0;
    w.deps.fetch = (async () => {
      probes++;
      if (probes < 4) throw new TypeError("fetch failed");
      return Response.json({ success: true, status: "ok" });
    }) as unknown as typeof fetch;
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 10_000, deps: w.deps });
    expect(result).toBe("running");
    expect(w.spawns).toHaveLength(0);
    // The other caller's lock is not ours to remove.
    expect(w.files.has(LOCK)).toBe(true);
  });

  it("returns before health answers when wait is false", async () => {
    const w = world();
    const result = await ensureWebApp({
      settings: SETTINGS,
      budgetMs: 0,
      wait: false,
      deps: w.deps,
    });
    expect(result).toBe("started");
    expect(w.spawns).toHaveLength(1);
  });

  it("releases the lock in the background after the web app answers when wait is false", async () => {
    const w = world({ upAfterPolls: 2 });
    await ensureWebApp({ settings: SETTINGS, budgetMs: 0, wait: false, deps: w.deps });
    // Let the background poll run out.
    for (let i = 0; i < 200 && w.files.has(LOCK); i++) await Promise.resolve();
    expect(w.files.has(LOCK)).toBe(false);
  });
});

/**
 * An in-memory file system with hard links. `beforeStep` runs before each file
 * operation, so a test can run a second caller in the middle of the first.
 */
function linkedFs(clock: { t: number }) {
  // Each name points to an inode; a hard link shares the inode.
  const names = new Map<string, { text: string; ctime: number }>();
  let beforeStep: (() => void) | null = null;
  const step = () => {
    const hook = beforeStep;
    beforeStep = null;
    hook?.();
  };
  const fs: LockFs = {
    createExclusive(path, text) {
      step();
      if (names.has(path)) return false;
      names.set(path, { text, ctime: clock.t });
      return true;
    },
    read(path) {
      step();
      return names.get(path)?.text ?? null;
    },
    remove(path) {
      step();
      names.delete(path);
    },
    link(from, to) {
      step();
      const inode = names.get(from);
      if (!inode || names.has(to)) return false;
      inode.ctime = clock.t;
      names.set(to, inode);
      return true;
    },
    ageMs(path) {
      step();
      const inode = names.get(path);
      return inode ? clock.t - inode.ctime : null;
    },
    replace(path, text) {
      step();
      names.set(path, { text, ctime: clock.t });
    },
  };
  return {
    fs,
    names,
    /** Run `hook` before the next file operation only. */
    once(hook: () => void) {
      beforeStep = hook;
    },
  };
}

describe("takeStartLock", () => {
  const stale = JSON.stringify({ pid: 999, at: 1_000 });
  const callerDeps = (fs: LockFs, pid: number, clock: { t: number }) => ({
    lockPath: LOCK,
    lockFs: fs,
    pid,
    now: () => clock.t,
    pidAlive: (candidate: number) => candidate !== 999,
  });

  it("gives the lock to exactly one of two callers that replace the same stale lock", () => {
    // Run caller B in full before each file step of caller A in turn.
    for (let at = 0; at < 20; at++) {
      const clock = { t: 100_000 };
      const disk = linkedFs(clock);
      disk.names.set(LOCK, { text: stale, ctime: 1_000 });
      let stepsSeen = 0;
      let bHeld: boolean | null = null;
      const arm = () =>
        disk.once(() => {
          if (stepsSeen++ < at) return arm();
          bHeld = takeStartLock(callerDeps(disk.fs, 200, clock));
        });
      arm();
      const aHeld = takeStartLock(callerDeps(disk.fs, 100, clock));
      if (bHeld === null) break; // A finished in fewer steps than `at`.
      expect({ at, holders: [aHeld, bHeld].filter(Boolean).length }).toEqual({ at, holders: 1 });
      const lock = JSON.parse(disk.names.get(LOCK)?.text ?? "null") as { pid: number };
      expect(lock.pid).toBe(aHeld ? 100 : 200);
    }
  });

  const tombFor = (text: string) =>
    `${LOCK}.${createHash("sha256").update(text).digest("hex").slice(0, 16)}.stale`;

  it("waits while another caller holds the tombstone for the same stale lock", () => {
    const clock = { t: 100_000 };
    const disk = linkedFs(clock);
    disk.names.set(LOCK, { text: stale, ctime: 1_000 });
    disk.names.set(tombFor(stale), { text: stale, ctime: clock.t - 1_000 });
    expect(takeStartLock(callerDeps(disk.fs, 100, clock))).toBe(false);
    expect(disk.names.has(tombFor(stale))).toBe(true);
    expect(disk.names.get(LOCK)?.text).toBe(stale);
  });

  it("clears a tombstone left by a crashed takeover, then the next caller takes the lock", () => {
    const clock = { t: 100_000 };
    const disk = linkedFs(clock);
    disk.names.set(LOCK, { text: stale, ctime: 1_000 });
    disk.names.set(tombFor(stale), { text: stale, ctime: clock.t - 20_001 });
    expect(takeStartLock(callerDeps(disk.fs, 100, clock))).toBe(false);
    expect(disk.names.has(tombFor(stale))).toBe(false);
    expect(takeStartLock(callerDeps(disk.fs, 200, clock))).toBe(true);
    expect(JSON.parse(disk.names.get(LOCK)?.text ?? "null")).toMatchObject({ pid: 200 });
    expect(disk.names.has(tombFor(stale))).toBe(false);
  });
});

describe("renameRetrying", () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });

  it("retries on Windows while a reader holds the target open", () => {
    let calls = 0;
    const waits: number[] = [];
    renameRetrying(
      "a",
      "b",
      () => {
        calls++;
        if (calls < 3) throw busy("EPERM");
      },
      "win32",
      (ms) => waits.push(ms)
    );
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("throws at once on other platforms and for other errors", () => {
    const fail = (code: string) => () => {
      throw busy(code);
    };
    expect(() => renameRetrying("a", "b", fail("EPERM"), "linux", () => {})).toThrow("EPERM");
    expect(() => renameRetrying("a", "b", fail("ENOENT"), "win32", () => {})).toThrow("ENOENT");
  });

  it("gives up on Windows after the last wait", () => {
    let calls = 0;
    const waits: number[] = [];
    const fail = () => {
      calls++;
      throw busy("EBUSY");
    };
    expect(() => renameRetrying("a", "b", fail, "win32", (ms) => waits.push(ms))).toThrow("EBUSY");
    expect(calls).toBe(waits.length + 1);
  });
});

describe("nodeLockFs.replace", () => {
  it("replaces the lock without a moment where a reader finds it missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-lock-replace-"));
    const path = join(dir, "web-start.lock");
    nodeLockFs.replace(path, "first");
    // A second process reads the lock in a tight loop while this one replaces it.
    const reader = Bun.spawn(
      [
        "node",
        "-e",
        `const fs = require("node:fs"); let missing = 0;
         const end = Date.now() + 1500;
         while (Date.now() < end) { try { fs.readFileSync(${JSON.stringify(path)}); } catch { missing++; } }
         console.log(missing);`,
      ],
      { stdout: "pipe" }
    );
    try {
      const end = Date.now() + 1500;
      for (let i = 0; Date.now() < end; i++) {
        nodeLockFs.replace(path, JSON.stringify({ pid: i, at: i }));
        await Promise.resolve();
      }
      const missing = Number((await new Response(reader.stdout).text()).trim());
      expect(missing).toBe(0);
      nodeLockFs.replace(path, "last");
      expect(readFileSync(path, "utf8")).toBe("last");
      expect(readdirSync(dir)).toEqual(["web-start.lock"]);
    } finally {
      reader.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureWebApp replaceOlder", () => {
  const LAUNCHER = "/home/test/.omms/bin/omms-launch.mjs";
  const HEADERS = { "x-omms-token": "local" };
  const NEW = "4.3.2";

  /**
   * An OMMS web app that answers health, version, and step-aside. After a 202 it
   * goes down; a spawn brings up the new version.
   */
  function replaceWorld(
    config: {
      version?: string | null;
      stepAside?: 202 | 404 | "throw";
      runtime?: string | null;
    } = {}
  ) {
    const w = world({ initial: "omms", runtime: config.runtime });
    const state = {
      alive: true,
      version: config.version === undefined ? "4.3.0" : config.version,
      dying: 0,
    };
    const requests: string[] = [];
    w.deps.launcherScript = LAUNCHER;
    w.deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      requests.push(`${method} ${path}`);
      if (path === "/api/health") {
        if (!state.alive) throw new TypeError("fetch failed");
        if (state.dying && --state.dying === 0) state.alive = false;
        return Response.json({ success: true, status: "ok" });
      }
      if (!state.alive) throw new TypeError("fetch failed");
      if (path === "/api/settings/version") {
        return state.version === null
          ? new Response("nope", { status: 404 })
          : Response.json({ running: state.version });
      }
      if (path === "/api/web/step-aside") {
        if (config.stepAside === "throw") throw new TypeError("fetch failed");
        if (config.stepAside === 404) return new Response("nope", { status: 404 });
        state.dying = 2;
        return new Response(null, { status: 202 });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const spawn = w.deps.spawn!;
    w.deps.spawn = ((command: string, args: string[], options: any) => {
      state.alive = true;
      state.version = NEW;
      return spawn(command, args, options);
    }) as unknown as EnsureDeps["spawn"];
    return { ...w, state, requests };
  }

  const options = (w: { deps: Partial<EnsureDeps> }) => ({
    settings: SETTINGS,
    budgetMs: 5_000,
    deps: w.deps,
    replaceOlder: { version: NEW, headers: HEADERS },
  });

  it("asks an older web app to step aside, then starts through the launcher", async () => {
    const w = replaceWorld();
    const result = await ensureWebApp(options(w));
    expect(result).toBe("started");
    expect(w.requests).toContain("POST /api/web/step-aside");
    expect(w.spawns).toHaveLength(1);
    expect(w.spawns[0]?.args).toEqual([LAUNCHER, "web"]);
    expect(w.state.version).toBe(NEW);
    expect(w.files.size).toBe(0);
  });

  it("sends the local token headers with the step-aside request", async () => {
    const seen: Record<string, string>[] = [];
    const w = replaceWorld();
    const fetchFn = w.deps.fetch!;
    w.deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/api/web/step-aside"))
        seen.push(init?.headers as Record<string, string>);
      return fetchFn(input, init);
    }) as unknown as typeof fetch;
    await ensureWebApp(options(w));
    expect(seen[0]).toMatchObject(HEADERS);
  });

  for (const version of ["4.3.2", "4.4.0", "unknown"]) {
    it(`uses a web app at ${version} as it is`, async () => {
      const w = replaceWorld({ version });
      const result = await ensureWebApp(options(w));
      expect(result).toBe("running");
      expect(w.requests).not.toContain("POST /api/web/step-aside");
      expect(w.spawns).toHaveLength(0);
    });
  }

  it("uses the running web app when it reports no version", async () => {
    const w = replaceWorld({ version: null });
    expect(await ensureWebApp(options(w))).toBe("running");
    expect(w.spawns).toHaveLength(0);
  });

  it("returns running and logs a code when the step-aside is refused", async () => {
    const w = replaceWorld({ stepAside: 404 });
    expect(await ensureWebApp(options(w))).toBe("running");
    expect(w.spawns).toHaveLength(0);
    expect(w.logs.some((entry) => entry.data.code === "step-aside-failed")).toBe(true);
    expect(w.files.size).toBe(0);
  });

  it("returns running and logs a code when the step-aside request fails", async () => {
    const w = replaceWorld({ stepAside: "throw" });
    expect(await ensureWebApp(options(w))).toBe("running");
    expect(w.spawns).toHaveLength(0);
    expect(w.logs.some((entry) => entry.data.code === "step-aside-failed")).toBe(true);
  });

  it("returns running and logs a code when no runtime is found", async () => {
    const w = replaceWorld({ runtime: null });
    expect(await ensureWebApp(options(w))).toBe("running");
    expect(w.requests).not.toContain("POST /api/web/step-aside");
    expect(w.logs.some((entry) => entry.data.code === "no-runtime")).toBe(true);
  });

  it("replaces the web app only once when two callers find it older", async () => {
    const w = replaceWorld();
    const results = await Promise.all([ensureWebApp(options(w)), ensureWebApp(options(w))]);
    expect(results.sort()).toEqual(["running", "started"]);
    expect(w.spawns).toHaveLength(1);
    expect(w.requests.filter((line) => line === "POST /api/web/step-aside")).toHaveLength(1);
    expect(w.files.size).toBe(0);
  });

  it("changes nothing without replaceOlder", async () => {
    const w = replaceWorld();
    const result = await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(result).toBe("running");
    expect(w.requests).not.toContain("GET /api/settings/version");
    expect(w.spawns).toHaveLength(0);
  });

  it("starts the own CLI script when there is no launcher", async () => {
    const w = world({ upAfterPolls: 2 });
    w.deps.launcherScript = null;
    await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(w.spawns[0]?.args).toEqual(["/pkg/dist/cli/index.js", "web"]);
  });

  it("starts through the launcher when nothing answers and the launcher exists", async () => {
    const w = world({ upAfterPolls: 2 });
    w.deps.launcherScript = LAUNCHER;
    await ensureWebApp({ settings: SETTINGS, budgetMs: 5_000, deps: w.deps });
    expect(w.spawns[0]?.args).toEqual([LAUNCHER, "web"]);
  });
});
