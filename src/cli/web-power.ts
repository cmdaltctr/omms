import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { WebAutostartOptions } from "../services/web-autostart.js";
import { packageVersion } from "../services/package-version.js";
import { ommsDir } from "../services/runtime-handoff.js";
import { launcherPath } from "../services/runtime-record.js";
import { compareVersions } from "../services/version-compare.js";

// Stop and Restart for the standalone `om-memory-system web` command.

/** The two choices the page offers; the web server passes them through unchanged. */
export type PowerAction = "stop" | "restart";
/** A restart through the launcher, so the newest copy on the machine serves after an update. */
export type ProcessAction = PowerAction | "update";

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
  /**
   * The OMMS web app that answers at `baseUrl`, or null when none does. The
   * version is null when this process may not read it, for example behind basic auth.
   */
  readOwner: (baseUrl: string) => Promise<{ instance: string; version: string | null } | null>;
  /** Ask the web app at `baseUrl` to step aside for `version`. True when it agrees. */
  stepAside: (baseUrl: string, version: string) => Promise<boolean>;
  /** The instance id the copy reports, so the handoff knows its own copy. */
  newInstance: () => string;
  /** The version on disk now; an in-place upgrade changes it after this process started. */
  version: () => string;
  env: NodeJS.ProcessEnv;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  exit: (code: number) => void;
  /** The runtime and arguments of this process, for a detached copy. */
  execPath: string;
  args: string[];
  /** The launcher at `~/.omms/bin`, or null when it is missing. */
  launcher: string | null;
  cwd: string;
  pid: number;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

let tokenHeader: Promise<Record<string, string>> | null = null;
/** The web app runs on this machine, so the local token file is enough. Read once. */
function localTokenHeader(): Promise<Record<string, string>> {
  tokenHeader ??= import("../services/auth-token.js").then(
    ({ AUTH_HEADER, getOrCreateAuthToken }) => ({
      [AUTH_HEADER]: getOrCreateAuthToken(),
    })
  );
  return tokenHeader;
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
      // Health skips basic auth, so a restart can find its copy with basic auth on.
      let instance: string;
      try {
        const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
        const body = (await health.json()) as { instance?: unknown };
        if (!health.ok || typeof body.instance !== "string") return null;
        instance = body.instance;
      } catch {
        return null;
      }
      try {
        const response = await fetch(`${baseUrl}/api/web/status`, {
          headers: await localTokenHeader(),
          signal: AbortSignal.timeout(1_000),
        });
        const body = (await response.json()) as { version?: unknown };
        const version = response.ok && typeof body.version === "string" ? body.version : null;
        return { instance, version };
      } catch {
        return { instance, version: null };
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
    version: () => packageVersion(),
    env: process.env,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    exit: (code) => process.exit(code),
    execPath: process.execPath,
    args: process.argv.slice(1),
    launcher: existsSync(launcherPath(ommsDir())) ? launcherPath(ommsDir()) : null,
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
}): (action: ProcessAction) => Promise<string | undefined> {
  const deps: PowerDeps = { ...productionDeps(options.autostart ?? {}), ...options.deps };
  const logFailure = (code: string) =>
    Promise.resolve(deps.log("Web app restart failed", { code })).catch(() => undefined);
  let stopped = false;

  /** Start the copy, check it, stop serving, and wait until the copy answers. */
  async function handOff(args: string[]): Promise<string | undefined> {
    let child: SpawnedChild;
    const instance = deps.newInstance();
    try {
      child = deps.spawn(deps.execPath, args, {
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
    // Each older owner is asked once; another older waiter can take the port after it.
    const askedAside = new Set<string>();
    while (deps.now() - began < HANDOFF_WAIT_MS) {
      if (exited) return giveUp("copy-exit", copyPid);
      const owner = await deps.readOwner(options.baseUrl);
      if (owner?.instance === instance) {
        deps.exit(0);
        return undefined;
      }
      // Another web app that waited for the port took it first.
      if (owner) {
        const ownVersion = deps.version();
        const order = owner.version === null ? null : compareVersions(owner.version, ownVersion);
        if (order === null || order >= 0) return yieldTo(child, copyPid);
        if (!askedAside.has(owner.instance)) {
          askedAside.add(owner.instance);
          // The copy needs a fresh wait once the older web app leaves.
          if (await deps.stepAside(options.baseUrl, ownVersion)) began = deps.now();
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
  async function yieldTo(child: SpawnedChild, copyPid: number): Promise<undefined> {
    child.kill("SIGTERM");
    await deps.removeStartLock(copyPid);
    await logFailure("other-owner");
    deps.exit(0);
    return undefined;
  }

  /** Keep or resume serving on the old process, and release the lock it wrote. Returns the code. */
  async function giveUp(code: string, copyPid?: number): Promise<string> {
    if (copyPid !== undefined) await deps.removeStartLock(copyPid);
    else if (!options.loginItem) await deps.removeStartLock(deps.pid);
    await logFailure(code);
    if (!stopped) return code;
    try {
      await options.resumeServer();
      stopped = false;
    } catch (error) {
      await logFailure(error instanceof Error ? error.name : "resume-error");
      deps.exit(1);
    }
    return code;
  }

  return async (action) => {
    if (action === "stop") {
      await options.stopServer();
      deps.exit(0);
      return undefined;
    }
    // After an update the copy of this process is the old version; the launcher picks the newest.
    if (action === "update" && !deps.launcher) {
      await logFailure("no-launcher");
      return "no-launcher";
    }
    const args = action === "update" ? [deps.launcher!, "web"] : deps.args;
    stopped = false;
    try {
      if (options.loginItem) {
        // The login item runs the launcher, so the service manager restart covers an update too.
        await options.stopServer();
        stopped = true;
        if (await deps.restartLoginItem()) {
          deps.exit(0);
          return undefined;
        }
      } else {
        // Hold other hosts off until the copy owns the port.
        await deps.writeStartLock(deps.pid);
      }
      return await handOff(args);
    } catch (error) {
      return giveUp(error instanceof Error ? error.name : "unknown");
    }
  };
}
