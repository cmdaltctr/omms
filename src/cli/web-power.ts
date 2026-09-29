import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import type { WebAutostartOptions } from "../services/web-autostart.js";

// Stop and Restart for the standalone `om-memory-system web` command.

export type PowerAction = "stop" | "restart";

interface SpawnedChild {
  pid?: number;
  unref(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface PowerDeps {
  spawn: (
    command: string,
    args: string[],
    options: { detached: true; stdio: "ignore"; cwd: string; windowsHide: true }
  ) => SpawnedChild;
  /** Restart the login item through the service manager. False when it cannot. */
  restartLoginItem: () => boolean | Promise<boolean>;
  /** Write the start lock, naming `pid`, so a host that starts meanwhile waits. */
  writeStartLock: (pid: number) => void | Promise<void>;
  exit: (code: number) => void;
  /** The runtime and arguments of this process, for a detached copy. */
  execPath: string;
  args: string[];
  cwd: string;
  pid: number;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

function productionDeps(options: WebAutostartOptions): PowerDeps {
  return {
    spawn: nodeSpawn as unknown as PowerDeps["spawn"],
    restartLoginItem: async () =>
      (await import("../services/web-autostart.js")).restartWebAutostart(options),
    writeStartLock: async (pid) => {
      const { nodeLockFs, startLockPath } = await import("../services/web-ensure.js");
      const path = startLockPath();
      nodeLockFs.remove(path);
      nodeLockFs.createExclusive(path, JSON.stringify({ pid, at: Date.now() }));
    },
    exit: (code) => process.exit(code),
    execPath: process.execPath,
    args: process.argv.slice(1),
    cwd: homedir(),
    pid: process.pid,
    log: async (message, data) => (await import("../services/logger.js")).log(message, data),
  };
}

/**
 * The callback the web server runs after it replies to Stop or Restart.
 * `stopServer` stops serving and any keep-alive timer. Restart starts a fresh
 * copy on the same port: the service manager for the login item, and a detached
 * copy otherwise. A detached child of the login item would die with its
 * launchd job or systemd control group.
 */
export function createPowerAction(options: {
  stopServer: () => Promise<void>;
  loginItem: boolean;
  autostart?: WebAutostartOptions;
  deps?: Partial<PowerDeps>;
}): (action: PowerAction) => Promise<void> {
  const deps: PowerDeps = { ...productionDeps(options.autostart ?? {}), ...options.deps };
  return async (action) => {
    if (action === "stop") {
      await options.stopServer();
      deps.exit(0);
      return;
    }
    try {
      // Hold other hosts off until the copy owns the port.
      if (!options.loginItem) await deps.writeStartLock(deps.pid);
      await options.stopServer();
      if (options.loginItem && (await deps.restartLoginItem())) return deps.exit(0);
      const child = deps.spawn(deps.execPath, deps.args, {
        detached: true,
        stdio: "ignore",
        cwd: deps.cwd,
        windowsHide: true,
      });
      child.on("error", () => undefined);
      child.unref();
      if (child.pid) await deps.writeStartLock(child.pid);
    } catch (error) {
      await Promise.resolve(
        deps.log("Web app restart failed", {
          code: error instanceof Error ? error.name : "unknown",
        })
      ).catch(() => undefined);
    }
    deps.exit(0);
  };
}
