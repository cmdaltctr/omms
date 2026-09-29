import { describe, expect, it } from "bun:test";
import { ensureWebApp, type EnsureDeps, type EnsureResult } from "../src/services/web-ensure.js";

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
    lockPath: LOCK,
    lockFs: {
      createExclusive: (path, text) => {
        if (files.has(path)) return false;
        files.set(path, text);
        return true;
      },
      read: (path) => files.get(path) ?? null,
      remove: (path) => void files.delete(path),
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
