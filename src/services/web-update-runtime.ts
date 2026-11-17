import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileInstallLock, installLockPath, type InstallLock } from "./global-install.js";
import { globalCommandVersion } from "./global-version.js";
import { installProblem } from "./install-check.js";
import { log } from "./logger.js";
import { packageVersion } from "./package-version.js";
import { nodeLockFs, processAlive } from "./web-ensure.js";
import { WebUpdate, type InstallChild, type InstallDeps } from "./web-update.js";

/** The npm check and installer of a standalone web app, with the real process, npm, and clock. */
export function startWebUpdate(
  restart: () => Promise<string | undefined>,
  canRestart: () => boolean,
  autoBlocked?: () => boolean
): WebUpdate {
  const update = new WebUpdate({
    version: packageVersion(),
    enabled: process.env.OMMS_DISABLE_UPDATE_CHECK !== "1",
    fetch,
    setInterval: (callback, ms) => setInterval(callback, ms),
    log,
    ...nodeInstallDeps(),
    exists: existsSync,
    // npm installs beside this Node.js, so read that install, not the first command on PATH.
    globalVersion: () => globalCommandVersion({ find: () => null }).version,
    installLock: nodeInstallLock(),
    installProblem: globalInstallProblem,
    restart,
    canRestart,
    autoBlocked,
    now: () => Date.now(),
  });
  update.start();
  return update;
}

/** The real install lock at `~/.omms/global-install.lock`, shared by the update button and `web update`. */
export function nodeInstallLock(home?: string): InstallLock {
  return fileInstallLock({
    lockPath: installLockPath(home),
    lockFs: nodeLockFs,
    pid: process.pid,
    now: () => Date.now(),
    pidAlive: processAlive,
  });
}

/** The install check of the global install beside this Node.js. */
export function globalInstallProblem(): string | null {
  const folder = globalCommandVersion({ find: () => null }).path;
  return folder ? installProblem(folder) : "package.json";
}

/** The real npm process, shared by the update button and `web update`. */
export function nodeInstallDeps(): InstallDeps {
  return {
    execPath: process.execPath,
    pathEnv: process.env.PATH,
    platform: process.platform,
    spawn: (command, args, options) =>
      spawn(command, args, {
        shell: options.shell,
        env: options.path === undefined ? undefined : { ...process.env, PATH: options.path },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      }) as InstallChild,
    // Resolves once npm has stopped. `taskkill /T` also stops npm under the cmd.exe
    // wrapper that `shell: true` starts; the child's own exit confirms it.
    killTree: (child) =>
      new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          }).on("error", () => child.kill("SIGKILL"));
        } else {
          child.kill("SIGTERM");
        }
      }),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
