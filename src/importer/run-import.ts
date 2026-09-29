import { resolve } from "node:path";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import type { HistoryImportArgs, ImportHost } from "./import-args.js";
import type { ImportPathMap, ImportReport } from "./importer.js";
import type { UnresolvedProject } from "./opencode-project.js";
import type { ImportSurface } from "./import-runs.js";
import { hostLabel } from "../types/host-label.js";

/** The two model roles an import uses; absent in a dry run or when the step is skipped. */
export interface HistoryImportModels {
  capture?: CaptureSummaryProvider;
  profile?: ModelPort;
}

export interface HistoryImportRun {
  /** Directory that relative paths and the default project resolve against. */
  cwd: string;
  models: HistoryImportModels;
  /** `alreadyHandled`: units found already done so far, which need no model call. */
  onProgress?: (
    processed: number,
    total: number,
    promptPreview: string,
    alreadyHandled?: number
  ) => void;
  signal?: AbortSignal;
  /** Record progress and take the host's lock for a run that calls models. */
  track?: { surface: ImportSurface; lockHeld?: boolean; expectedTotal?: number };
  /** Saved directory maps; defaults to the global `importPathMaps`. */
  savedPathMaps?: readonly ImportPathMap[];
  /** Web selection, already re-resolved against the source; `args.source` is its real path. */
  selection?: {
    keys: string[];
    cutoff: number;
    /** Shared snapshot key of an OpenCode source, reused from the listing. */
    snapshotKey?: string;
  };
}

export type HistoryImportReport = ImportReport & {
  childSessionsFolded?: number;
  unresolvedProjects?: UnresolvedProject[];
};

const dryRunCapture: CaptureSummaryProvider = {
  summarize: async () => {
    throw new Error("A dry-run cannot call the capture model");
  },
};

/** Another process or surface holds this host's import lock. */
export class ImportAlreadyRunningError extends Error {
  constructor(host: ImportHost) {
    super(`${host === "opencode" ? "An" : "A"} ${hostLabel(host)} import is already running`);
    this.name = "ImportAlreadyRunningError";
  }
}

/**
 * Run one host's history import with already-parsed, validated arguments.
 * With `track`, a run that calls models takes the host's cross-process lock
 * and records its progress; a dry run never does either.
 */
export async function runHistoryImport(
  host: ImportHost,
  args: HistoryImportArgs,
  run: HistoryImportRun
): Promise<HistoryImportReport> {
  if (!run.track || args.dryRun) return runUntracked(host, args, run);
  let release: (() => Promise<void>) | null = null;
  if (!run.track.lockHeld) {
    const { tryAcquireBackfillLock } = await import("./backfill-lock.js");
    release = await tryAcquireBackfillLock(host);
    if (!release) throw new ImportAlreadyRunningError(host);
  }
  try {
    const { startImportRun } = await import("./import-runs.js");
    const { workProgress } = await import("./import-progress.js");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    run.signal?.addEventListener("abort", onAbort, { once: true });
    if (run.signal?.aborted) controller.abort();
    const recorder = await startImportRun(host, run.track.surface, {
      onPause: () => controller.abort(),
    });
    try {
      const report = await runUntracked(host, args, {
        ...run,
        signal: controller.signal,
        onProgress: (processed, total, preview, alreadyHandled = 0) => {
          // Units already in the ledger need no model call: leave them out of
          // the progress so the bar and the time left describe real work.
          const work = workProgress(processed, total, alreadyHandled, run.track!.expectedTotal);
          recorder.progress(work.done, work.total);
          run.onProgress?.(processed, total, preview, alreadyHandled);
        },
      });
      const handled = report.unitsImported + report.unitsSkipped + report.unitsFailed;
      await recorder.finish(
        recorder.pauseRequested ? "paused" : controller.signal.aborted ? "stopped" : "done",
        {
          // The total stays the one progress last reported; a real run has no
          // "would import" count of its own.
          done: handled,
          imported: report.unitsImported,
          skipped: report.unitsSkipped,
          failed: report.unitsFailed,
        }
      );
      await recordUnresolved(host, report);
      return report;
    } catch (error) {
      await recorder
        .finish(
          recorder.pauseRequested ? "paused" : controller.signal.aborted ? "stopped" : "failed",
          {},
          error
        )
        .catch(() => {});
      throw error;
    } finally {
      run.signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    await release?.();
  }
}

async function recordUnresolved(host: ImportHost, report: HistoryImportReport): Promise<void> {
  try {
    const { recordUnresolvedDirectories, unresolvedDirectoriesOf } =
      await import("../services/backfill-state.js");
    await recordUnresolvedDirectories(host, unresolvedDirectoriesOf(report));
  } catch {
    // The list is a convenience for the Settings page; the import itself succeeded.
  }
}

async function runUntracked(
  host: ImportHost,
  args: HistoryImportArgs,
  run: HistoryImportRun
): Promise<HistoryImportReport> {
  const at = (path: string) => resolve(run.cwd, path);
  const project = args.scope === "current-project" ? at(args.project ?? ".") : undefined;
  const { runPathMaps } = await import("./import-path-maps.js");
  const pathMaps = await runPathMaps(args.pathMaps, run.cwd, run.savedPathMaps);
  const capture = run.models.capture ?? dryRunCapture;

  if (host === "opencode") {
    const { importOpencodeHistory } = await import("./opencode-import.js");
    return importOpencodeHistory({
      ...(args.source ? { dbPath: at(args.source) } : {}),
      dryRun: args.dryRun,
      ...(args.since !== undefined ? { since: args.since } : {}),
      ...(args.until !== undefined ? { until: args.until } : {}),
      ...(args.session ? { session: args.session } : {}),
      ...(run.selection
        ? {
            selectionKeys: run.selection.keys,
            cutoff: run.selection.cutoff,
            ...(run.selection.snapshotKey
              ? { snapshot: { key: run.selection.snapshotKey, mode: "reuse" as const } }
              : {}),
          }
        : {}),
      ...(project ? { project } : {}),
      ...(args.maxSessions ? { maxSessions: args.maxSessions } : {}),
      ...(args.profileBatch ? { profileBatch: args.profileBatch } : {}),
      pathMaps,
      force: args.force,
      skipMemories: args.skipMemories,
      skipProfile: args.skipProfile,
      ...(run.signal ? { signal: run.signal } : {}),
      ...(run.onProgress ? { onProgress: run.onProgress } : {}),
      ...(run.models.capture ? { provider: capture } : {}),
      ...(run.models.profile ? { profileModel: run.models.profile } : {}),
    });
  }

  const deps = {
    provider: capture,
    ...(run.onProgress ? { onProgress: run.onProgress } : {}),
    ...(run.signal ? { signal: run.signal } : {}),
    ...(!args.skipProfile
      ? {
          profile: {
            ...(run.models.profile ? { model: run.models.profile } : {}),
            ...(args.profileBatch ? { batchSize: args.profileBatch } : {}),
          },
        }
      : {}),
  };
  const filters = {
    scope: args.scope,
    currentDirectory: project ?? run.cwd,
    ...(args.session ? { session: args.session } : {}),
    ...(run.selection ? { selectionKeys: run.selection.keys, cutoff: run.selection.cutoff } : {}),
    ...(args.since !== undefined ? { since: args.since } : {}),
    ...(args.until !== undefined ? { until: args.until } : {}),
    ...(args.maxSessions ? { maxSessions: args.maxSessions } : {}),
    ...(args.source ? { root: at(args.source) } : {}),
    force: args.force,
    dryRun: args.dryRun,
    skipMemories: args.skipMemories,
    pathMaps,
  };

  if (host === "claude-code") {
    const { importClaudeHistory } = await import("./claude-import.js");
    return importClaudeHistory(deps, filters);
  }

  const { importPiHistory } = await import("./importer.js");
  const { loadPiSessionForImport } = await import("./session-loader.js");
  return importPiHistory({ ...deps, loadSession: loadPiSessionForImport }, filters);
}

/** The same plain-text report for every host and surface. */
export function formatHistoryImportReport(
  host: ImportHost,
  report: HistoryImportReport,
  model?: string
): string {
  const lines = [`${hostLabel(host)} history import${report.dryRun ? " (dry-run)" : ""}`];
  if (model) lines.push(`  model: ${model}`);
  lines.push(
    `  sessions: ${report.sessionsLoaded}/${report.sessionsDiscovered} loaded, ${report.sessionsFilteredOut} filtered out` +
      (report.childSessionsFolded !== undefined
        ? `, ${report.childSessionsFolded} child sessions folded`
        : "")
  );
  lines.push(
    `  memory units: ${report.unitsWouldImport} pending, ${report.unitsAlreadyHandled} already done, ` +
      `${report.unitsImported} imported, ${report.unitsSkipped} skipped, ${report.unitsFailed} failed`
  );
  for (const project of report.projects) {
    lines.push(
      `  project ${project.directory}: ${project.sessions} sessions, ${project.units} units`
    );
  }
  for (const unresolved of report.unresolvedProjects ?? []) {
    lines.push(
      `  unresolved ${unresolved.directory}: ${unresolved.sessions} sessions, ${unresolved.units} units (use --map)`
    );
  }
  for (const unresolvable of report.unresolvableSessions) {
    lines.push(`  unresolved ${unresolvable.cwd ?? "(no cwd)"}: ${unresolvable.file} (use --map)`);
  }
  if (report.unitsUntimed) {
    lines.push(
      `  turns without a timestamp: ${report.unitsUntimed} (date limits cannot exclude them)`
    );
  }
  if (report.unitsHeldBack) {
    lines.push(
      `  newer turns held back: ${report.unitsHeldBack}; list the sessions again and import to include them`
    );
  }
  if (report.loadErrors.length > 0) lines.push(`  load errors: ${report.loadErrors.length}`);
  if (report.profile) {
    lines.push(
      `  profile prompts: ${report.profile.promptsWouldRecord} pending, ${report.profile.promptsRecorded} recorded, ` +
        `${report.profile.promptsAlreadyHandled} already done; ${report.profile.batchesBuilt} batches, ` +
        `${report.profile.remaining} remaining`
    );
    if (report.profile.error) lines.push(`  profile error: ${report.profile.error}`);
  }
  return lines.join("\n");
}

/** Counts and identifiers for the log. Unit previews hold prompt text, so they stay out. */
export function summarizeHistoryImportReport(report: HistoryImportReport) {
  return {
    dryRun: report.dryRun,
    sessionsDiscovered: report.sessionsDiscovered,
    sessionsLoaded: report.sessionsLoaded,
    sessionsFilteredOut: report.sessionsFilteredOut,
    unitsTotal: report.unitsTotal,
    unitsImported: report.unitsImported,
    unitsWouldImport: report.unitsWouldImport,
    unitsSkipped: report.unitsSkipped,
    unitsFailed: report.unitsFailed,
    unitsAlreadyHandled: report.unitsAlreadyHandled,
    unitsHeldBack: report.unitsHeldBack ?? 0,
    unitsUntimed: report.unitsUntimed ?? 0,
    projects: report.projects.length,
    unresolved: (report.unresolvedProjects?.length ?? 0) + report.unresolvableSessions.length,
    loadErrors: report.loadErrors.length,
    profile: report.profile
      ? {
          promptsRecorded: report.profile.promptsRecorded,
          promptsWouldRecord: report.profile.promptsWouldRecord,
          batchesBuilt: report.profile.batchesBuilt,
          remaining: report.profile.remaining,
          failed: Boolean(report.profile.error),
        }
      : undefined,
  };
}

/** A failed unit or profile step makes the whole run unsuccessful. */
export function historyImportFailed(report: HistoryImportReport): boolean {
  return report.unitsFailed > 0 || Boolean(report.profile?.error);
}
