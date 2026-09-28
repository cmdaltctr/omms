import { CONFIG, refreshConfigIfChanged } from "../config.js";
import type { CaptureSummaryProvider } from "../core/host.js";
import { log } from "../services/logger.js";
import type { BackfillHost } from "./backfill-model.js";
import { tryAcquireBackfillLock } from "./backfill-lock.js";
import {
  getBackfillCutoff,
  recordUnresolvedDirectories,
  unresolvedDirectoriesOf,
  updateBackfillStatus,
  type BackfillStatus,
} from "../services/backfill-state.js";
import {
  runHistoryImport,
  type HistoryImportModels,
  type HistoryImportReport,
} from "./run-import.js";
import type { HistoryImportArgs } from "./import-args.js";
import { isManualImportRunning } from "./manual-import-guard.js";
import { isBackfillPaused, type ImportSurface } from "./import-runs.js";
import { workProgress } from "./import-progress.js";

type Counts = BackfillStatus["counts"];
type Run = typeof runHistoryImport;
export interface AutoBackfillOptions {
  host: BackfillHost;
  cwd: string;
  resolveModels: () => Promise<{ model: string; models: HistoryImportModels }>;
  notify: (message: string) => void;
  run?: Run;
  wait?: () => Promise<void>;
  now?: () => number;
  enabled?: () => boolean;
  signal?: AbortSignal;
  /** `web` for Run now and Resume on the Settings page. */
  surface?: ImportSurface;
  /** Skip the start-up delay and the autoBackfill switch: the user asked for this run. */
  userStarted?: boolean;
}

const zero = (): Counts => ({ imported: 0, skipped: 0, failed: 0, pending: 0, unresolved: 0 });
function counts(report: HistoryImportReport): Counts {
  return {
    imported: report.unitsImported,
    skipped: report.unitsSkipped,
    failed: report.unitsFailed,
    pending: report.unitsWouldImport,
    unresolved: (report.unresolvedProjects?.length ?? 0) + report.unresolvableSessions.length,
  };
}
const delay = (signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, 30_000);
    signal?.addEventListener("abort", done, { once: true });
  });

/** Schedule one host's history import after startup; callers do not await it. */
export async function scheduleAutoBackfill(options: AutoBackfillOptions): Promise<void> {
  if (!options.userStarted) await (options.wait ?? (() => delay(options.signal)))();
  if (options.signal?.aborted) return;
  const enabled =
    options.enabled ??
    (() => CONFIG.autoBackfill && process.env.OMMS_DISABLE_AUTO_BACKFILL !== "1");
  if (!options.userStarted && !enabled()) return;
  if (isManualImportRunning(options.host)) return;
  // A paused backfill waits for Resume, across host starts.
  if (await isBackfillPaused(options.host).catch(() => false)) return;
  const release = await tryAcquireBackfillLock(options.host);
  if (!release) return;
  const clock = options.now ?? Date.now;
  const run = options.run ?? runHistoryImport;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let state: BackfillStatus["state"] = "failed";
  let model: string | null = null;
  let current = zero();
  let lastError: unknown;
  try {
    if (controller.signal.aborted) {
      state = "stopped";
      return;
    }
    const cutoff = await getBackfillCutoff(options.host, clock());
    const args: HistoryImportArgs = {
      help: false,
      dryRun: true,
      force: false,
      skipMemories: false,
      skipProfile: false,
      scope: "all-projects",
      pathMaps: [],
      until: cutoff,
      errors: [],
    };
    const dry = await run(options.host, args, {
      cwd: options.cwd,
      models: {},
      signal: controller.signal,
    });
    current = counts(dry);
    await recordUnresolvedDirectories(options.host, unresolvedDirectoriesOf(dry)).catch(
      (error: unknown) =>
        log("Backfill unresolved directories write failed", {
          host: options.host,
          error: error instanceof Error ? error.message : String(error),
        })
    );
    if (controller.signal.aborted) {
      state = "stopped";
      return;
    }
    if (!current.pending) {
      state = "done";
      return;
    }
    const resolved = await options.resolveModels();
    if (controller.signal.aborted) {
      state = "stopped";
      return;
    }
    model = resolved.model;
    options.notify(
      `${options.host} automatic import: ${current.pending} exchanges with ${model}. Set autoBackfill to false to stop it.`
    );
    state = "running";
    await updateBackfillStatus(options.host, { state, model, counts: current });
    if (controller.signal.aborted) {
      state = "stopped";
      return;
    }
    let failures = 0;
    const capture = resolved.models.capture;
    const models: HistoryImportModels = capture
      ? {
          ...resolved.models,
          capture: {
            summarize: async (request) => {
              try {
                const result = await capture.summarize(request);
                failures = 0;
                return result;
              } catch (error) {
                lastError = error;
                if (++failures >= 5) controller.abort();
                throw error;
              }
            },
          } satisfies CaptureSummaryProvider,
        }
      : resolved.models;
    let checkedAt = clock();
    let processed = 0;
    let pendingWrite: Promise<void> = Promise.resolve();
    const real = await run(
      options.host,
      { ...args, dryRun: false },
      {
        cwd: options.cwd,
        models,
        signal: controller.signal,
        track: {
          surface: options.surface ?? "auto",
          lockHeld: true,
          expectedTotal: dry.unitsWouldImport,
        },
        onProgress: (done, total, _preview, alreadyHandled = 0) => {
          // Count only units that needed work; ledger hits are not pending work.
          processed = workProgress(done, total, alreadyHandled, dry.unitsWouldImport).done;
          const now = clock();
          if (now - checkedAt < 5_000) return;
          checkedAt = now;
          refreshConfigIfChanged(options.cwd);
          if (!options.userStarted && !CONFIG.autoBackfill) controller.abort();
          current = { ...current, pending: Math.max(0, dry.unitsWouldImport - processed) };
          pendingWrite = pendingWrite
            .then(() =>
              updateBackfillStatus(options.host, { state: "running", model, counts: current })
            )
            .catch((error: unknown) => {
              log("Backfill status write failed", {
                host: options.host,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        },
      }
    );
    await pendingWrite;
    const finished = real.unitsImported + real.unitsSkipped + real.unitsFailed;
    current = { ...counts(real), pending: Math.max(0, dry.unitsWouldImport - finished) };
    const paused = await isBackfillPaused(options.host).catch(() => false);
    state = controller.signal.aborted || paused ? "stopped" : real.unitsFailed ? "failed" : "done";
    if (!options.signal?.aborted) {
      options.notify(
        `${options.host} automatic import ${state}: ${current.imported} imported, ${current.failed} failed. autoBackfill controls the next run.`
      );
    }
  } catch (error) {
    lastError = error;
    state = controller.signal.aborted ? "stopped" : "failed";
  } finally {
    try {
      await updateBackfillStatus(options.host, { state, model, counts: current, error: lastError });
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      await release();
    }
  }
}
