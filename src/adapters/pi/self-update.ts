import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostSelfUpdateDeps,
  installedFromNpm,
  markerStatus,
  startHostSelfUpdate,
  unpinnedPackageSource,
  updateNotice,
  updateSuffix,
  watchHostUpdate,
  type HostInstallSource,
  type HostSelfUpdateDeps,
  type HostSelfUpdateResult,
} from "../../services/host-self-update.js";
import { log } from "../../services/logger.js";
import { packageVersion } from "../../services/package-version.js";

// Pi does not update its packages by itself. At session start OMMS runs
// `pi update npm:om-memory-system` in the background when npm has a newer
// release, then tells the user to restart. The decision lives in
// `src/services/host-self-update.ts`; this file adds the Pi wording, the
// footer suffix and the install check.

const PI_UPDATE_ARGS = ["update", "npm:om-memory-system"];
const PI_UPDATE_COMMAND = `pi ${PI_UPDATE_ARGS.join(" ")}`;

/** What the update needs from one Pi session. */
export interface PiUpdateSession {
  hasUI: boolean;
  notify: (message: string, level: "info" | "warning") => void;
}

export interface PiSelfUpdate {
  /** Check npm and start the update. Never rejects. The caller does not wait for it. */
  start(session: PiUpdateSession, onSuffixChange: () => void): Promise<void>;
  /** Footer text to add after the status glyph, or an empty string. */
  suffix(): string;
  /** Stop the marker poll and drop the session. Keeps the suffix for the next session. */
  stop(): void;
}

export interface PiSelfUpdateOptions {
  hostDeps?: () => HostSelfUpdateDeps;
  watch?: typeof watchHostUpdate;
  log?: (message: string, data: Record<string, unknown>, level?: "error") => void;
}

/** Pi's settings file lists the package source. `PI_CODING_AGENT_DIR` moves Pi's folder. */
function readPiSettings(env: NodeJS.ProcessEnv): string | null {
  const dir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  try {
    return readFileSync(join(dir, "settings.json"), "utf8");
  } catch {
    return null;
  }
}

/** Production inputs for Pi: npm, the Pi marker file and a detached `pi update`. */
export function piHostSelfUpdateDeps(
  options: { env?: NodeJS.ProcessEnv; modulePath?: string } = {}
): HostSelfUpdateDeps {
  const env = options.env ?? process.env;
  const modulePath = options.modulePath ?? fileURLToPath(import.meta.url);
  const installSource = (): HostInstallSource => {
    if (!installedFromNpm(modulePath)) return "local";
    return unpinnedPackageSource(readPiSettings(env)) ? "npm" : "pinned";
  };
  return hostSelfUpdateDeps({
    logLabel: "Pi plugin self-update",
    currentVersion: packageVersion(),
    command: "pi",
    args: PI_UPDATE_ARGS,
    markerPath: join(homedir(), ".omms", "pi-plugin-update.json"),
    installSource,
    log,
    env,
  });
}

export function createPiSelfUpdate(options: PiSelfUpdateOptions = {}): PiSelfUpdate {
  const hostDeps = options.hostDeps ?? (() => piHostSelfUpdateDeps());
  const watch = options.watch ?? watchHostUpdate;
  const logError = options.log ?? log;
  // One notification per state per version for the life of the Pi process.
  const notified = new Set<string>();
  let suffix = "";
  let stopWatch: (() => void) | null = null;
  let generation = 0;
  let current: { session: PiUpdateSession; onSuffixChange: () => void } | null = null;
  // Sessions that start while a check runs share it, so one release spawns one update.
  let inFlight: Promise<HostSelfUpdateResult> | null = null;
  // Once installed, only a restart helps: a later session must not run the update again.
  let installed = false;

  const attempt = (action: () => void): void => {
    try {
      action();
    } catch {
      // A stale Pi context must not stop the update path.
    }
  };

  const notifyOnce = (key: string, message: string, level: "info" | "warning"): void => {
    if (!current || notified.has(key)) return;
    notified.add(key);
    const { session } = current;
    attempt(() => session.notify(message, level));
  };

  const show = (
    deps: HostSelfUpdateDeps,
    update: string,
    state: "available" | "installing" | "installed"
  ): void => {
    if (state === "installed") installed = true;
    if (state !== "installing") {
      const next = updateSuffix(update, state);
      if (next !== suffix) {
        suffix = next;
        const change = current?.onSuffixChange;
        if (change) attempt(change);
      }
    }
    const text = updateNotice({
      hostName: "Pi",
      command: PI_UPDATE_COMMAND,
      current: deps.currentVersion,
      update,
      state,
    });
    notifyOnce(`${state}:${update}`, text, state === "available" ? "warning" : "info");
  };

  return {
    async start(session, onSuffixChange) {
      const mine = ++generation;
      stopWatch?.();
      stopWatch = null;
      current = session.hasUI ? { session, onSuffixChange } : null;
      if (installed) return;
      try {
        const deps = hostDeps();
        inFlight ??= startHostSelfUpdate(deps).finally(() => {
          inFlight = null;
        });
        const { code, update } = await inFlight;
        // No interface, no label or notice. A shutdown or newer session replaces this one.
        if (!update || !session.hasUI || mine !== generation) return;
        if (code !== "started" && code !== "recent") {
          show(deps, update, "available");
          return;
        }
        const read = () => markerStatus(deps.readMarker(), update);
        const status = read();
        if (status === "installed") show(deps, update, "installed");
        else if (status === "failed") show(deps, update, "available");
        else {
          show(deps, update, "installing");
          stopWatch = watch({
            read,
            onSettled: (outcome) => {
              if (mine === generation)
                show(deps, update, outcome === "installed" ? "installed" : "available");
            },
          });
        }
      } catch (error) {
        logError(
          "Pi plugin self-update failed",
          { code: error instanceof Error ? error.name : "unknown" },
          "error"
        );
      }
    },
    suffix: () => suffix,
    stop() {
      generation++;
      stopWatch?.();
      stopWatch = null;
      current = null;
    },
  };
}
