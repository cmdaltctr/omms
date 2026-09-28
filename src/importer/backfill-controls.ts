import { CONFIG } from "../config.js";
import { log } from "../services/logger.js";
import {
  getAutoCaptureProviderStatus,
  resolvePiLiveModel,
} from "../services/ai/live-model-choice.js";
import { parseBackfillModel, type BackfillHost } from "./backfill-model.js";
import { readImportRun, setBackfillPaused, type ImportRun } from "./import-runs.js";
import type { HistoryImportModels } from "./run-import.js";

type ResolveModels = () => Promise<{ model: string; models: HistoryImportModels }>;

/** A host runtime in this process that can resolve its signed-in backfill models. */
const hostResolvers = new Map<BackfillHost, ResolveModels>();

export function registerHostBackfillModels(host: BackfillHost, resolve: ResolveModels): void {
  hostResolvers.set(host, resolve);
}

/** A control request the page cannot carry out; `status` is the HTTP status. */
export class BackfillControlError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "BackfillControlError";
  }
}

const label = (host: BackfillHost) => (host === "pi" ? "Pi" : "OpenCode");

/** True when the host's backfill model is the external API, directly or through the live rule. */
export function backfillUsesExternal(host: BackfillHost): boolean {
  const choice = parseBackfillModel(CONFIG, host);
  if (choice === "external") return true;
  if (choice !== "inherit") return false;
  if (host === "pi") return resolvePiLiveModel(CONFIG).kind === "manual";
  const live = getAutoCaptureProviderStatus(CONFIG);
  return live.ready && live.mode === "manual";
}

/** Why Run now is not available for the host in this process, or null when it is. */
export function runNowUnavailableReason(host: BackfillHost): string | null {
  if (hostResolvers.has(host)) return null;
  if (!backfillUsesExternal(host)) {
    return `Open ${label(host)}, or choose the external API for ${label(host)}'s backfill`;
  }
  return null;
}

async function resolveModels(
  host: BackfillHost
): Promise<{ model: string; models: HistoryImportModels }> {
  const hostResolver = hostResolvers.get(host);
  if (hostResolver && !backfillUsesExternal(host)) return hostResolver();
  const { resolveExternalBackfillModels } = await import("./external-backfill-models.js");
  return resolveExternalBackfillModels(host, CONFIG);
}

export interface BackfillHostStatus {
  run: ImportRun | null;
  runNowUnavailable: string | null;
}

/** Run now, Pause, and Resume for each host's backfill, run in this process. */
export class BackfillControls {
  private readonly controllers = new Map<BackfillHost, AbortController>();

  async status(): Promise<Record<BackfillHost, BackfillHostStatus>> {
    const entry = async (host: BackfillHost) => ({
      run: await readImportRun(host),
      runNowUnavailable: runNowUnavailableReason(host),
    });
    return { pi: await entry("pi"), opencode: await entry("opencode") };
  }

  async runNow(host: BackfillHost, cwd: string): Promise<{ started: true }> {
    const reason = runNowUnavailableReason(host);
    if (reason) throw new BackfillControlError(reason, 409);
    const current = await readImportRun(host);
    if (current?.state === "running" || this.controllers.has(host)) {
      throw new BackfillControlError(
        `${host === "pi" ? "A" : "An"} ${label(host)} import is already running`,
        409
      );
    }
    if (current?.paused) {
      throw new BackfillControlError(`${label(host)}'s backfill is paused; resume it first`, 409);
    }
    // Fail fast with the missing setting instead of starting a run that cannot call a model.
    if (backfillUsesExternal(host) || !hostResolvers.has(host)) {
      const { externalModelIssues } = await import("../services/ai/live-model-choice.js");
      const issues = externalModelIssues(CONFIG);
      if (issues.length > 0) throw new BackfillControlError(issues.join("; "), 409);
    }
    const controller = new AbortController();
    this.controllers.set(host, controller);
    const { scheduleAutoBackfill } = await import("./auto-backfill.js");
    void scheduleAutoBackfill({
      host,
      cwd,
      signal: controller.signal,
      surface: "web",
      userStarted: true,
      resolveModels: () => resolveModels(host),
      notify: (message) =>
        log("Backfill from the Settings page", { host, message: message.slice(0, 200) }),
    })
      .catch((error: unknown) =>
        log("Backfill from the Settings page failed", {
          host,
          error: error instanceof Error ? error.name : "unknown",
        })
      )
      .finally(() => {
        if (this.controllers.get(host) === controller) this.controllers.delete(host);
      });
    return { started: true };
  }

  /** Stop after the current exchange; a run in another process sees the flag at its next write. */
  async pause(host: BackfillHost): Promise<{ paused: true }> {
    await setBackfillPaused(host, true);
    this.controllers.get(host)?.abort();
    return { paused: true };
  }

  async resume(host: BackfillHost, cwd: string): Promise<{ started: true }> {
    const reason = runNowUnavailableReason(host);
    if (reason) throw new BackfillControlError(reason, 409);
    await setBackfillPaused(host, false);
    return this.runNow(host, cwd);
  }
}
