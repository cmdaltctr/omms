import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { WebAutostartOptions } from "../services/web-autostart.js";
import { packageVersion } from "../services/package-version.js";
import { compareVersions } from "../services/version-compare.js";

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
    options: {
      detached: true;
      stdio: "ignore";
      cwd: string;
      windowsHide: true;
      env: NodeJS.ProcessEnv;
    }
  ) => SpawnedChild;
  /** Restart the login item through the service manager. False when it cannot. */
  restartLoginItem: () => boolean | Promise<boolean>;
  /** Write the start lock, naming `pid`, so a host that starts meanwhile waits. */
  writeStartLock: (pid: number) => void | Promise<void>;
  /** Remove the start lock when it names `pid`. */
  removeStartLock: (pid: number) => void | Promise<void>;
  /** The OMMS web app that answers at `baseUrl`, or null when none does. */
  readOwner: (baseUrl: string) => Promise<{ instance: string; version: string } | null>;
  /** Ask the web app at `baseUrl` to step aside for `version`. True when it agrees. */
  stepAside: (baseUrl: string, version: string) => Promise<boolean>;
  /** The instance id the copy reports, so the handoff knows its own copy. */
  newInstance: () => string;
  /** The version of this web app. */
  version: string;
  env: NodeJS.ProcessEnv;
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

/** The web app runs on this machine, so the local token file is enough. */
async function localTokenHeader(): Promise<Record<string, string>> {
  const { AUTH_HEADER, getOrCreateAuthToken } = await import("../services/auth-token.js");
  return { [AUTH_HEADER]: getOrCreateAuthToken() };
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
    readOwner: async (baseUrl) => {
      try {
        const response = await fetch(`${baseUrl}/api/web/status`, {
          headers: await localTokenHeader(),
          signal: AbortSignal.timeout(1_000),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { instance?: unknown; version?: unknown };
        if (typeof body.instance !== "string" || typeof body.version !== "string") return null;
        return { instance: body.instance, version: body.version };
      } catch {
        return null;
      }
    },
    stepAside: async (baseUrl, version) => {
      try {
        const response = await fetch(`${baseUrl}/api/web/step-aside`, {
          method: "POST",
          headers: { ...(await localTokenHeader()), "content-type": "application/json" },
          body: JSON.stringify({ version }),
          signal: AbortSignal.timeout(1_000),
        });
        return response.status === 202;
      } catch {
        return false;
      }
    },
    newInstance: () => randomUUID(),
    version: packageVersion(),
    env: process.env,
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
    const instance = deps.newInstance();
    try {
      child = deps.spawn(deps.execPath, deps.args, {
        detached: true,
        stdio: "ignore",
        cwd: deps.cwd,
        windowsHide: true,
        env: { ...deps.env, OMMS_WEB_INSTANCE: instance },
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
    let began = deps.now();
    let askedAside = false;
    while (deps.now() - began < HANDOFF_WAIT_MS) {
      if (exited) return giveUp("copy-exit", copyPid);
      const owner = await deps.readOwner(options.baseUrl);
      if (owner?.instance === instance) return deps.exit(0);
      // Another web app that waited for the port took it first.
      if (owner) {
        const order = compareVersions(owner.version, deps.version);
        if (order === null || order >= 0) return yieldTo(child, copyPid);
        if (!askedAside) {
          askedAside = true;
          // The copy needs a fresh wait once the older web app leaves.
          if (await deps.stepAside(options.baseUrl, deps.version)) began = deps.now();
        }
      }
      await deps.sleep(HANDOFF_POLL_MS);
    }
    if (exited) return giveUp("copy-exit", copyPid);
    // A copy that never answers would wait as a non-owner for ever.
    child.kill("SIGTERM");
    return giveUp("handoff", copyPid);
  }

  /** A web app of the same or a newer version serves, so the copy would only wait. */
  async function yieldTo(child: SpawnedChild, copyPid: number): Promise<void> {
    child.kill("SIGTERM");
    await deps.removeStartLock(copyPid);
    await logFailure("other-owner");
    deps.exit(0);
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
