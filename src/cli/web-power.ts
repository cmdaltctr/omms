import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import type { WebAutostartOptions } from "../services/web-autostart.js";

// Stop and Restart for the standalone `om-memory-system web` command.

/** The two choices the page offers; the web server passes them through unchanged. */
export type PowerAction = "stop" | "restart";

interface SpawnedChild {
  pid?: number;
  unref(): void;
  on(event: "error" | "exit", listener: () => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

/** How long a fresh copy must stay up before the old process stops serving. */
const SPAWN_CHECK_MS = 1_000;
/** How long the old process waits for the copy to answer before it serves again. */
export const HANDOFF_WAIT_MS = 15_000;
const HANDOFF_POLL_MS = 250;

/** Injected so tests check the restart order without spawning or exiting. */
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
  /** Remove the start lock when it names `pid`. */
  removeStartLock: (pid: number) => void | Promise<void>;
  /** True when an OMMS web app answers health at `baseUrl`. */
  probe: (baseUrl: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
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
      nodeLockFs.replace(startLockPath(), JSON.stringify({ pid, at: Date.now() }));
    },
    removeStartLock: async (pid) =>
      (await import("../services/web-ensure.js")).removeStartLockFor(pid),
    probe: async (baseUrl) => {
      try {
        const response = await fetch(`${baseUrl}/api/health`, {
          signal: AbortSignal.timeout(1_000),
        });
        const body = (await response.json()) as { success?: unknown; status?: unknown };
        return response.ok && body.success === true && body.status === "ok";
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
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
 * `stopServer` stops serving and any keep-alive timer; `resumeServer` undoes it.
 * Restart starts a fresh copy on the same port: the service manager for the
 * login item, and a detached copy otherwise. A detached child of the login item
 * would die with its launchd job or systemd control group. A restart never
 * leaves the port empty because the copy failed: the old process serves again.
 */
export function createPowerAction(options: {
  stopServer: () => Promise<void>;
  resumeServer: () => Promise<void>;
  /** The URL this web app serves, where the copy must answer after the handoff. */
  baseUrl: string;
  loginItem: boolean;
  autostart?: WebAutostartOptions;
  deps?: Partial<PowerDeps>;
}): (action: PowerAction) => Promise<void> {
  const deps: PowerDeps = { ...productionDeps(options.autostart ?? {}), ...options.deps };
  const logFailure = (code: string) =>
    Promise.resolve(deps.log("Web app restart failed", { code })).catch(() => undefined);
  let stopped = false;

  /** Start the copy, check it, stop serving, and wait until the copy answers. */
  async function handOff(): Promise<void> {
    let child: SpawnedChild;
    try {
      child = deps.spawn(deps.execPath, deps.args, {
        detached: true,
        stdio: "ignore",
        cwd: deps.cwd,
        windowsHide: true,
      });
    } catch {
      return giveUp("spawn-error");
    }
    let failed = false;
    let exited = false;
    child.on("error", () => (failed = true));
    child.on("exit", () => (exited = true));
    child.unref();
    const copyPid = child.pid;
    if (!copyPid) return giveUp("spawn-error");
    // A missing script or a broken runtime ends the copy within this time.
    await deps.sleep(SPAWN_CHECK_MS);
    if (failed) return giveUp("spawn-error");
    if (exited) return giveUp("copy-exit");

    await deps.writeStartLock(copyPid);
    if (!stopped) {
      await options.stopServer();
      stopped = true;
    }
    // The copy waits as a non-owner and takes the port within about 7 seconds.
    const began = deps.now();
    while (deps.now() - began < HANDOFF_WAIT_MS) {
      if (exited) return giveUp("copy-exit", copyPid);
      if (await deps.probe(options.baseUrl)) return deps.exit(0);
      await deps.sleep(HANDOFF_POLL_MS);
    }
    if (exited) return giveUp("copy-exit", copyPid);
    // A copy that never answers would wait as a non-owner for ever.
    child.kill("SIGTERM");
    return giveUp("handoff", copyPid);
  }

  /** Keep or resume serving on the old process, and release the lock it wrote. */
  async function giveUp(code: string, copyPid?: number): Promise<void> {
    if (copyPid !== undefined) await deps.removeStartLock(copyPid);
    else if (!options.loginItem) await deps.removeStartLock(deps.pid);
    await logFailure(code);
    if (!stopped) return;
    try {
      await options.resumeServer();
      stopped = false;
    } catch (error) {
      await logFailure(error instanceof Error ? error.name : "resume-error");
      deps.exit(1);
    }
  }

  return async (action) => {
    if (action === "stop") {
      await options.stopServer();
      deps.exit(0);
      return;
    }
    stopped = false;
    try {
      if (options.loginItem) {
        await options.stopServer();
        stopped = true;
        if (await deps.restartLoginItem()) return deps.exit(0);
      } else {
        // Hold other hosts off until the copy owns the port.
        await deps.writeStartLock(deps.pid);
      }
      await handOff();
    } catch (error) {
      await giveUp(error instanceof Error ? error.name : "unknown");
    }
  };
}
