import { describe, expect, it } from "bun:test";
import { createPowerAction, type PowerDeps } from "../src/cli/web-power.js";

type CopyFate =
  | "serves" // the copy answers health after the old process stops
  | "error-at-spawn" // the runtime reports a spawn error
  | "exit-at-spawn" // the copy exits during the spawn check
  | "exit-after-stop" // the copy exits after the old process stopped serving
  | "silent"; // the copy runs but never answers

/** The version of the web app that restarts. */
const OWN_VERSION = "4.9.0";

/** Records what happens, in order, so the tests can check the sequence. */
function fake(
  config: {
    loginItemRestarts?: boolean;
    spawnFails?: boolean;
    noPid?: boolean;
    copy?: CopyFate;
    /** Another web app that takes the port before the copy, and its version. */
    intruder?: string;
  } = {}
) {
  const fate = config.copy ?? "serves";
  // The intruder serves until it is asked to step aside.
  let intruder = config.intruder;
  const events: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const spawns: { command: string; args: string[]; options: any; unref: number }[] = [];
  const clock = { t: 0 };
  let stopped = false;
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const emit = (event: string) => {
    events.push(`copy-${event}`);
    for (const listener of listeners[event] ?? []) listener();
  };
  const deps: Partial<PowerDeps> = {
    spawn: ((command: string, args: string[], options: any) => {
      if (config.spawnFails) throw new Error("spawn failed");
      const record = { command, args, options, unref: 0 };
      spawns.push(record);
      events.push("spawn");
      return {
        pid: config.noPid ? undefined : 4242,
        unref: () => record.unref++,
        on: (event: string, listener: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(listener);
        },
        kill: () => {
          events.push("copy-killed");
          return true;
        },
      };
    }) as unknown as PowerDeps["spawn"],
    restartLoginItem: () => {
      events.push("login-item-restart");
      return config.loginItemRestarts ?? true;
    },
    writeStartLock: (pid) => void events.push(`lock:${pid}`),
    removeStartLock: (pid) => void events.push(`unlock:${pid}`),
    readOwner: async () => {
      if (!stopped) return null;
      if (intruder) return { instance: "other-instance", version: intruder };
      if (fate !== "serves") return null;
      return { instance: spawns[0]?.options.env.OMMS_WEB_INSTANCE, version: OWN_VERSION };
    },
    stepAside: async (_baseUrl, version) => {
      events.push(`step-aside:${version}`);
      intruder = undefined;
      return true;
    },
    newInstance: () => "copy-instance",
    version: OWN_VERSION,
    env: { PATH: "/usr/bin" },
    sleep: async (ms) => {
      // The copy's fate plays out while the old process waits.
      if (fate === "error-at-spawn" && clock.t === 0) emit("error");
      if (fate === "exit-at-spawn" && clock.t === 0) emit("exit");
      if (stopped && fate === "exit-after-stop" && !events.includes("copy-exit")) emit("exit");
      clock.t += ms;
    },
    now: () => clock.t,
    exit: (code) => void events.push(`exit:${code}`),
    execPath: "/usr/bin/node",
    args: ["/pkg/dist/cli/index.js", "web"],
    cwd: "/home/test",
    pid: 100,
    log: (_message, data) => void logs.push(data),
  };
  const stopServer = async () => {
    stopped = true;
    events.push("stop");
  };
  const resumeServer = async () => {
    stopped = false;
    events.push("resume");
  };
  const action = (loginItem: boolean) =>
    createPowerAction({
      stopServer,
      resumeServer,
      baseUrl: "http://127.0.0.1:4747",
      loginItem,
      deps,
    });
  return { deps, events, logs, spawns, clock, action };
}

describe("web power action", () => {
  it("stops the server and exits with 0 on Stop", async () => {
    const f = fake();
    await f.action(false)("stop");
    expect(f.events).toEqual(["stop", "exit:0"]);
    expect(f.spawns).toHaveLength(0);
  });

  it("stops Stop for the login item too, without asking the service manager", async () => {
    const f = fake();
    await f.action(true)("stop");
    expect(f.events).toEqual(["stop", "exit:0"]);
  });

  it("restarts the login item through the service manager", async () => {
    const f = fake();
    await f.action(true)("restart");
    expect(f.events).toEqual(["stop", "login-item-restart", "exit:0"]);
    expect(f.spawns).toHaveLength(0);
  });

  it("falls back to a detached copy when the service manager command fails", async () => {
    const f = fake({ loginItemRestarts: false });
    await f.action(true)("restart");
    expect(f.events).toEqual(["stop", "login-item-restart", "spawn", "lock:4242", "exit:0"]);
    expect(f.spawns).toHaveLength(1);
  });

  it("starts the copy before it stops serving, then exits once the copy answers", async () => {
    const f = fake();
    await f.action(false)("restart");
    // Hosts are held off first, the copy is checked, and only then does the old process stop.
    expect(f.events).toEqual(["lock:100", "spawn", "lock:4242", "stop", "exit:0"]);
    const [copy] = f.spawns;
    expect(copy?.command).toBe("/usr/bin/node");
    expect(copy?.args).toEqual(["/pkg/dist/cli/index.js", "web"]);
    expect(copy?.options).toMatchObject({ detached: true, stdio: "ignore", cwd: "/home/test" });
    expect(copy?.unref).toBe(1);
  });

  it("gives the copy an instance id and keeps the rest of the environment", async () => {
    const f = fake();
    await f.action(false)("restart");
    expect(f.spawns[0]?.options.env).toEqual({
      PATH: "/usr/bin",
      OMMS_WEB_INSTANCE: "copy-instance",
    });
  });
});

describe("web power action: another web app takes the port", () => {
  it("asks an older web app to step aside, then exits once the copy answers", async () => {
    const f = fake({ intruder: "4.8.0" });
    await f.action(false)("restart");
    expect(f.events).toEqual([
      "lock:100",
      "spawn",
      "lock:4242",
      "stop",
      `step-aside:${OWN_VERSION}`,
      "exit:0",
    ]);
    expect(f.logs).toEqual([]);
  });

  it("stops the copy and exits when a web app of the same version took the port", async () => {
    const f = fake({ intruder: OWN_VERSION });
    await f.action(false)("restart");
    expect(f.events).toEqual([
      "lock:100",
      "spawn",
      "lock:4242",
      "stop",
      "copy-killed",
      "unlock:4242",
      "exit:0",
    ]);
    expect(f.logs).toEqual([{ code: "other-owner" }]);
  });

  it("stops the copy and exits when a newer web app took the port", async () => {
    const f = fake({ intruder: "5.0.0" });
    await f.action(false)("restart");
    expect(f.events).toEqual([
      "lock:100",
      "spawn",
      "lock:4242",
      "stop",
      "copy-killed",
      "unlock:4242",
      "exit:0",
    ]);
    expect(f.logs).toEqual([{ code: "other-owner" }]);
  });
});

describe("web power action: failed restart, detached copy", () => {
  it("keeps serving when the copy cannot be spawned", async () => {
    const f = fake({ spawnFails: true });
    await f.action(false)("restart");
    expect(f.events).toEqual(["lock:100", "unlock:100"]);
    expect(f.logs).toEqual([{ code: "spawn-error" }]);
  });

  it("keeps serving when the copy gets no pid", async () => {
    const f = fake({ noPid: true });
    await f.action(false)("restart");
    expect(f.events).toEqual(["lock:100", "spawn", "unlock:100"]);
    expect(f.logs).toEqual([{ code: "spawn-error" }]);
  });

  it("keeps serving when the runtime reports a spawn error", async () => {
    const f = fake({ copy: "error-at-spawn" });
    await f.action(false)("restart");
    expect(f.events).toEqual(["lock:100", "spawn", "copy-error", "unlock:100"]);
    expect(f.logs).toEqual([{ code: "spawn-error" }]);
  });

  it("keeps serving when the copy exits during the spawn check", async () => {
    const f = fake({ copy: "exit-at-spawn" });
    await f.action(false)("restart");
    expect(f.events).toEqual(["lock:100", "spawn", "copy-exit", "unlock:100"]);
    expect(f.logs).toEqual([{ code: "copy-exit" }]);
  });

  it("serves again when the copy exits after the old process stopped", async () => {
    const f = fake({ copy: "exit-after-stop" });
    await f.action(false)("restart");
    expect(f.events).toEqual([
      "lock:100",
      "spawn",
      "lock:4242",
      "stop",
      "copy-exit",
      "unlock:4242",
      "resume",
    ]);
    expect(f.logs).toEqual([{ code: "copy-exit" }]);
  });

  it("stops a silent copy and serves again after 15 seconds", async () => {
    const f = fake({ copy: "silent" });
    await f.action(false)("restart");
    expect(f.events).toEqual([
      "lock:100",
      "spawn",
      "lock:4242",
      "stop",
      "copy-killed",
      "unlock:4242",
      "resume",
    ]);
    expect(f.logs).toEqual([{ code: "handoff" }]);
    expect(f.clock.t).toBeGreaterThanOrEqual(1_000 + 15_000);
    expect(f.clock.t).toBeLessThan(1_000 + 15_000 + 500);
  });
});

describe("web power action: failed restart, login item", () => {
  it("serves again when the service manager fails and the copy cannot be spawned", async () => {
    const f = fake({ loginItemRestarts: false, spawnFails: true });
    await f.action(true)("restart");
    expect(f.events).toEqual(["stop", "login-item-restart", "resume"]);
    expect(f.logs).toEqual([{ code: "spawn-error" }]);
  });

  it("serves again when the service manager fails and the copy exits at once", async () => {
    const f = fake({ loginItemRestarts: false, copy: "exit-at-spawn" });
    await f.action(true)("restart");
    expect(f.events).toEqual(["stop", "login-item-restart", "spawn", "copy-exit", "resume"]);
    expect(f.logs).toEqual([{ code: "copy-exit" }]);
  });
});
