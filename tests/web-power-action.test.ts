import { describe, expect, it } from "bun:test";
import { createPowerAction, type PowerDeps } from "../src/cli/web-power.js";

/** Records what happens, in order, so the tests can check the sequence. */
function fake(config: { loginItemRestarts?: boolean; spawnFails?: boolean } = {}) {
  const events: string[] = [];
  const spawns: { command: string; args: string[]; options: any; unref: number }[] = [];
  const deps: Partial<PowerDeps> = {
    spawn: ((command: string, args: string[], options: any) => {
      if (config.spawnFails) throw new Error("spawn failed");
      const record = { command, args, options, unref: 0 };
      spawns.push(record);
      events.push("spawn");
      return { pid: 4242, unref: () => record.unref++, on: () => undefined };
    }) as unknown as PowerDeps["spawn"],
    restartLoginItem: () => {
      events.push("login-item-restart");
      return config.loginItemRestarts ?? true;
    },
    writeStartLock: (pid) => void events.push(`lock:${pid}`),
    exit: (code) => void events.push(`exit:${code}`),
    execPath: "/usr/bin/node",
    args: ["/pkg/dist/cli/index.js", "web"],
    cwd: "/home/test",
    pid: 100,
    log: () => undefined,
  };
  const stopServer = async () => void events.push("stop");
  return { deps, events, spawns, stopServer };
}

describe("web power action", () => {
  it("stops the server and exits with 0 on Stop", async () => {
    const f = fake();
    await createPowerAction({ stopServer: f.stopServer, loginItem: false, deps: f.deps })("stop");
    expect(f.events).toEqual(["stop", "exit:0"]);
    expect(f.spawns).toHaveLength(0);
  });

  it("stops Stop for the login item too, without asking the service manager", async () => {
    const f = fake();
    await createPowerAction({ stopServer: f.stopServer, loginItem: true, deps: f.deps })("stop");
    expect(f.events).toEqual(["stop", "exit:0"]);
  });

  it("restarts the login item through the service manager", async () => {
    const f = fake();
    await createPowerAction({
      stopServer: f.stopServer,
      loginItem: true,
      deps: f.deps,
    })("restart");
    expect(f.events).toEqual(["stop", "login-item-restart", "exit:0"]);
    expect(f.spawns).toHaveLength(0);
  });

  it("falls back to a detached copy when the service manager command fails", async () => {
    const f = fake({ loginItemRestarts: false });
    await createPowerAction({
      stopServer: f.stopServer,
      loginItem: true,
      deps: f.deps,
    })("restart");
    expect(f.events).toEqual(["stop", "login-item-restart", "spawn", "lock:4242", "exit:0"]);
    expect(f.spawns).toHaveLength(1);
  });

  it("spawns a detached copy with the same arguments and names it in the start lock", async () => {
    const f = fake();
    await createPowerAction({
      stopServer: f.stopServer,
      loginItem: false,
      deps: f.deps,
    })("restart");
    // The old process holds hooks off first, then the copy takes over the lock.
    expect(f.events).toEqual(["lock:100", "stop", "spawn", "lock:4242", "exit:0"]);
    const [copy] = f.spawns;
    expect(copy?.command).toBe("/usr/bin/node");
    expect(copy?.args).toEqual(["/pkg/dist/cli/index.js", "web"]);
    expect(copy?.options).toMatchObject({ detached: true, stdio: "ignore", cwd: "/home/test" });
    expect(copy?.unref).toBe(1);
  });

  it("still exits when the copy cannot be started", async () => {
    const f = fake({ spawnFails: true });
    await createPowerAction({
      stopServer: f.stopServer,
      loginItem: false,
      deps: f.deps,
    })("restart");
    expect(f.events).toEqual(["lock:100", "stop", "exit:0"]);
  });
});
