import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { globalCommandVersion } from "./global-version.js";
import { log } from "./logger.js";
import { packageVersion } from "./package-version.js";
import { WebUpdate, type InstallChild } from "./web-update.js";

/** The npm check and installer of a standalone web app, with the real process, npm, and clock. */
export function startWebUpdate(
  restart: () => Promise<string | undefined>,
  canRestart: () => boolean
): WebUpdate {
  const update = new WebUpdate({
    version: packageVersion(),
    enabled: process.env.OMMS_DISABLE_UPDATE_CHECK !== "1",
    fetch,
    setInterval: (callback, ms) => setInterval(callback, ms),
    log,
    execPath: process.execPath,
    platform: process.platform,
    exists: existsSync,
    spawn: (command, args, options) =>
      spawn(command, args, {
        shell: options.shell,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      }) as InstallChild,
    // npm installs beside this Node.js, so read that install, not the first command on PATH.
    globalVersion: () => globalCommandVersion({ find: () => null }).version,
    restart,
    canRestart,
    killTree: (child) => {
      // `taskkill /T` also stops npm under the cmd.exe wrapper that `shell: true` starts.
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill("SIGTERM");
      }
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  });
  update.start();
  return update;
}
