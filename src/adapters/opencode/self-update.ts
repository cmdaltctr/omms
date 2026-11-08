import { homedir } from "node:os";
import { join } from "node:path";
import {
  hostSelfUpdateDeps,
  installedFromNpm,
  unpinnedCacheFolder,
  type HostSelfUpdateDeps,
} from "../../services/host-self-update.js";

// OpenCode's update inputs, shared by the TUI footer and the background
// service. The service runs the check too, so OpenCode without a TUI (for
// example OpenChamber or `opencode serve`) also updates. The marker file stops
// the two from starting the same update twice.

/** The background service checks npm at start and then this often, like the footer. */
export const OPENCODE_SERVICE_CHECK_MS = 6 * 3_600_000;

/** Production inputs for OpenCode: npm, the OpenCode marker file and a detached `opencode plugin update`. */
export function opencodeSelfUpdateDeps(options: {
  modulePath: string;
  currentVersion: string;
  log: HostSelfUpdateDeps["log"];
  home?: string;
  env?: NodeJS.ProcessEnv;
}): HostSelfUpdateDeps {
  const { modulePath } = options;
  return hostSelfUpdateDeps({
    logLabel: "OpenCode plugin self-update",
    currentVersion: options.currentVersion,
    command: "opencode",
    args: ["plugin", "update", "om-memory-system"],
    markerPath: join(options.home ?? homedir(), ".omms", "opencode-plugin-update.json"),
    modulePath,
    installSource: () =>
      !installedFromNpm(modulePath) ? "local" : unpinnedCacheFolder(modulePath) ? "npm" : "pinned",
    log: options.log,
    ...(options.env ? { env: options.env } : {}),
  });
}

/**
 * Run the update check now and then every `intervalMs`. A failed check never
 * throws. The timer does not keep the process alive. Returns a stop function.
 */
export function startOpencodeServiceSelfUpdate(options: {
  run: () => unknown;
  intervalMs?: number;
}): () => void {
  const check = () => {
    try {
      void Promise.resolve(options.run()).catch(() => {});
    } catch {
      // The update is housekeeping. It never breaks the service.
    }
  };
  check();
  const timer = setInterval(check, options.intervalMs ?? OPENCODE_SERVICE_CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
