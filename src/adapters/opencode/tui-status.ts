import { fileURLToPath } from "node:url";
import {
  hostUpdateStatus,
  startHostSelfUpdate,
  updateNotice,
  updateSuffix,
  watchHostUpdate,
  type HostSelfUpdateResult,
  type HostUpdateStatus,
} from "../../services/host-self-update.js";
import { ommsStatusLabel } from "../../services/status-glyphs.js";
import { opencodeSelfUpdateDeps } from "./self-update.js";
import { availableUpdate, latestNpmVersion } from "../../services/update-check.js";

const UPDATE_COMMAND = "opencode plugin update om-memory-system";
// The background service keeps the old copy loaded until it restarts too.
const RESTART = "restart OpenCode and run opencode service restart";

/** What the OpenCode footer shows: the web app's state and a newer release, if any. */
export interface TuiStatusState {
  web: "warming" | "connected" | "offline";
  update: string | null;
  /** "installed" once the background update has finished; otherwise "available". */
  updateState?: "available" | "installed";
}

export function tuiStatusText(state: TuiStatusState): string {
  const web = ommsStatusLabel(state.web === "offline" ? "web app off" : state.web);
  return state.update
    ? `${web}${updateSuffix(state.update, state.updateState ?? "available")}`
    : web;
}

export interface TuiStatusDeps {
  currentVersion: string;
  healthUrl: string;
  fetch: typeof fetch;
  setText: (text: string) => void;
  /** Shown once per update state and version. */
  notify: (message: string) => void;
  checkUpdates?: boolean;
  healthIntervalMs?: number;
  updateIntervalMs?: number;
  /** Reads npm and starts the background update. Without it the check only reads npm. */
  selfUpdate?: () => Promise<HostSelfUpdateResult>;
  /** The state the update marker records for a version. */
  readUpdateStatus?: (version: string) => HostUpdateStatus | null;
  watchIntervalMs?: number;
  watchLimitMs?: number;
}

/**
 * Keep the footer text current: the web app is polled, and npm is asked for a
 * newer release at start and then every few hours. A newer release installs in
 * the background when the host allows it. Returns a stop function.
 */
export function startTuiStatus(deps: TuiStatusDeps): () => void {
  const state: TuiStatusState = { web: "warming", update: null };
  let stopped = false;
  let stopWatch: (() => void) | undefined;
  const shown = new Set<string>();
  const show = () => {
    if (!stopped) deps.setText(tuiStatusText(state));
  };

  const checkHealth = async () => {
    try {
      const response = await deps.fetch(deps.healthUrl, { signal: AbortSignal.timeout(3_000) });
      state.web = response.ok ? "connected" : "offline";
    } catch {
      state.web = "offline";
    }
    show();
  };

  /** One toast per update state and version. */
  const toast = (update: string, notice: "available" | "installing" | "installed") => {
    const key = `${notice}:${update}`;
    if (stopped || shown.has(key)) return;
    shown.add(key);
    deps.notify(
      updateNotice({
        hostName: "OpenCode",
        command: UPDATE_COMMAND,
        restart: RESTART,
        current: deps.currentVersion,
        update,
        state: notice,
      })
    );
  };

  const settle = (update: string, outcome: "installed" | "failed") => {
    state.updateState = outcome === "installed" ? "installed" : "available";
    show();
    toast(update, outcome === "installed" ? "installed" : "available");
  };

  const selfUpdate =
    deps.selfUpdate ??
    (async (): Promise<HostSelfUpdateResult> => ({
      code: "local",
      update: availableUpdate(deps.currentVersion, await latestNpmVersion(deps.fetch)),
    }));

  const checkUpdate = async () => {
    try {
      // The restart installs the release; there is nothing more to ask npm.
      if (state.updateState === "installed") return;
      const { code, update } = await selfUpdate();
      state.update = update;
      state.updateState = "available";
      show();
      if (!update || stopped) return;
      if (code !== "started" && code !== "recent") return toast(update, "available");
      const status = (deps.readUpdateStatus ?? (() => null))(update);
      if (status === "installed" || status === "failed") return settle(update, status);
      toast(update, "installing");
      stopWatch?.();
      stopWatch = watchHostUpdate({
        read: () => (deps.readUpdateStatus ?? (() => null))(update),
        onSettled: (outcome) => {
          try {
            settle(update, outcome);
          } catch {
            // A failed toast must not break the timer.
          }
        },
        intervalMs: deps.watchIntervalMs,
        maxMs: deps.watchLimitMs,
      });
    } catch {
      // A failed update check must not break the footer.
    }
  };

  show();
  void checkHealth();
  if (deps.checkUpdates !== false) void checkUpdate();
  const timers = [setInterval(() => void checkHealth(), deps.healthIntervalMs ?? 30_000)];
  if (deps.checkUpdates !== false) {
    timers.push(setInterval(() => void checkUpdate(), deps.updateIntervalMs ?? 6 * 3_600_000));
  }
  for (const timer of timers) timer.unref?.();
  return () => {
    stopped = true;
    stopWatch?.();
    for (const timer of timers) clearInterval(timer);
  };
}

/** Wire the status to this install: its version, the configured web app port, and global fetch. */
export async function startInstalledTuiStatus(
  callbacks: Pick<TuiStatusDeps, "setText" | "notify">
): Promise<() => void> {
  const [{ CONFIG }, { packageVersion }, { log }] = await Promise.all([
    import("../../config.js"),
    import("../../services/package-version.js"),
    import("../../services/logger.js"),
  ]);
  const host = CONFIG.webServerHost === "0.0.0.0" ? "127.0.0.1" : CONFIG.webServerHost;
  const currentVersion = packageVersion();
  const modulePath = fileURLToPath(import.meta.url);
  const update = opencodeSelfUpdateDeps({
    modulePath,
    currentVersion,
    log: (message, data) => log(message, data),
  });
  return startTuiStatus({
    ...callbacks,
    currentVersion,
    selfUpdate: () => startHostSelfUpdate(update),
    readUpdateStatus: (version) => hostUpdateStatus(update, version),
    healthUrl: `http://${host.includes(":") ? `[${host}]` : host}:${CONFIG.webServerPort}/api/health`,
    fetch: globalThis.fetch.bind(globalThis),
    checkUpdates: process.env.OMMS_DISABLE_UPDATE_CHECK !== "1",
  });
}
