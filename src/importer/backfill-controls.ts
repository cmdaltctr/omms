import { CONFIG } from "../config.js";
import { log } from "../services/logger.js";
import { hostLabel } from "../types/host-label.js";
import {
  externalModelIssues,
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

export interface SettingsModel {
  provider: string;
  model: string;
  name: string;
}

/** OpenCode's model access for web imports, Health, and Settings, when OpenCode runs this process. */
export interface OpencodeHostModels {
  isProviderConnected(providerID: string): boolean;
  createImportModels(
    ref: { providerID: string; modelID: string },
    directory: string
  ): Promise<Required<HistoryImportModels>>;
  listSettingsModels(): Promise<SettingsModel[] | null>;
}

let opencodeHostModels: OpencodeHostModels | null = null;

export function registerOpencodeHostModels(models: OpencodeHostModels | null): void {
  opencodeHostModels = models;
}

export function getOpencodeHostModels(): OpencodeHostModels | null {
  return opencodeHostModels;
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
  // Claude Code has no host model: its backfill needs the external API, so name the missing setting.
  if (host === "claude-code") {
    const issues = externalModelIssues(CONFIG);
    return issues.length > 0 ? issues.join("; ") : null;
  }
  if (hostResolvers.has(host)) return null;
  if (!backfillUsesExternal(host)) {
    return `Open ${hostLabel(host)}, or choose the external API for ${hostLabel(host)}'s backfill`;
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
    return {
      pi: await entry("pi"),
      opencode: await entry("opencode"),
      "claude-code": await entry("claude-code"),
    };
  }

  async runNow(host: BackfillHost, cwd: string): Promise<{ started: true }> {
    const reason = runNowUnavailableReason(host);
    if (reason) throw new BackfillControlError(reason, 409);
    const current = await readImportRun(host);
    if (current?.state === "running" || this.controllers.has(host)) {
      throw new BackfillControlError(
        `${host === "opencode" ? "An" : "A"} ${hostLabel(host)} import is already running`,
        409
      );
    }
    if (current?.paused) {
      throw new BackfillControlError(
        `${hostLabel(host)}'s backfill is paused; resume it first`,
        409
      );
    }
    // Fail fast with the missing setting instead of starting a run that cannot call a model.
    if (backfillUsesExternal(host) || !hostResolvers.has(host)) {
      const { externalModelIssues } = await import("../services/ai/live-model-choice.js");
      const issues = externalModelIssues(CONFIG);
      if (issues.length > 0) throw new BackfillControlError(issues.join("; "), 409);
    }
    await this.launch(host, cwd, true);
    return { started: true };
  }

  /**
   * The automatic run after a host start, under the auto-backfill rules: the
   * start-up delay, `autoBackfill`, pause, and the single-run lock. The web
   * app calls it on the first Claude Code session start. Returns false when
   * the run cannot start here.
   */
  async startAuto(host: BackfillHost, cwd: string): Promise<{ started: boolean }> {
    if (this.controllers.has(host)) return { started: false };
    const reason = runNowUnavailableReason(host);
    if (reason) {
      log("Automatic backfill not started", { host, reason });
      return { started: false };
    }
    await this.launch(host, cwd, false);
    return { started: true };
  }

  private async launch(host: BackfillHost, cwd: string, userStarted: boolean): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(host, controller);
    const { scheduleAutoBackfill } = await import("./auto-backfill.js");
    const source = userStarted ? "Backfill from the Settings page" : "Automatic backfill";
    void scheduleAutoBackfill({
      host,
      cwd,
      signal: controller.signal,
      ...(userStarted ? { surface: "web" as const, userStarted: true } : {}),
      resolveModels: () => resolveModels(host),
      notify: (message) => log(source, { host, message: message.slice(0, 200) }),
    })
      .catch((error: unknown) =>
        log(`${source} failed`, {
          host,
          error: error instanceof Error ? error.name : "unknown",
        })
      )
      .finally(() => {
        if (this.controllers.get(host) === controller) this.controllers.delete(host);
      });
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
    try {
      return await this.runNow(host, cwd);
    } catch (error) {
      // Run now refused (a run is active, or a setting is missing): stay paused.
      await setBackfillPaused(host, true);
      throw error;
    }
  }
}
