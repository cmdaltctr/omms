import { availableUpdate, latestNpmVersion } from "../../services/update-check.js";

/** What the OpenCode footer shows: the web app's state and a newer release, if any. */
export interface TuiStatusState {
  web: "warming" | "connected" | "offline";
  update: string | null;
}

export function tuiStatusText(state: TuiStatusState): string {
  const web = state.web === "offline" ? "omms:web app off" : `omms:${state.web}`;
  return state.update ? `${web} · ${state.update} available` : web;
}

export interface TuiStatusDeps {
  currentVersion: string;
  healthUrl: string;
  fetch: typeof fetch;
  setText: (text: string) => void;
  /** Shown once per start when a newer release is on npm. */
  notify: (message: string) => void;
  checkUpdates?: boolean;
  healthIntervalMs?: number;
  updateIntervalMs?: number;
}

/**
 * Keep the footer text current: the web app is polled, and npm is asked for a
 * newer release at start and then every few hours. Returns a stop function.
 */
export function startTuiStatus(deps: TuiStatusDeps): () => void {
  const state: TuiStatusState = { web: "warming", update: null };
  let stopped = false;
  let notified: string | null = null;
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

  const checkUpdate = async () => {
    const update = availableUpdate(deps.currentVersion, await latestNpmVersion(deps.fetch));
    state.update = update;
    show();
    if (update && notified !== update && !stopped) {
      notified = update;
      deps.notify(
        `om-memory-system ${update} is available (running ${deps.currentVersion}). Run: opencode plugin update om-memory-system, then restart OpenCode.`
      );
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
    for (const timer of timers) clearInterval(timer);
  };
}

/** Wire the status to this install: its version, the configured web app port, and global fetch. */
export async function startInstalledTuiStatus(
  callbacks: Pick<TuiStatusDeps, "setText" | "notify">
): Promise<() => void> {
  const [{ CONFIG }, { packageVersion }] = await Promise.all([
    import("../../config.js"),
    import("../../services/package-version.js"),
  ]);
  const host = CONFIG.webServerHost === "0.0.0.0" ? "127.0.0.1" : CONFIG.webServerHost;
  return startTuiStatus({
    ...callbacks,
    currentVersion: packageVersion(),
    healthUrl: `http://${host.includes(":") ? `[${host}]` : host}:${CONFIG.webServerPort}/api/health`,
    fetch: globalThis.fetch.bind(globalThis),
    checkUpdates: process.env.OMMS_DISABLE_UPDATE_CHECK !== "1",
  });
}
