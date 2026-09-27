import { resolve } from "node:path";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import type { HistoryImportArgs, ImportHost } from "./import-args.js";
import type { ImportReport } from "./importer.js";
import type { UnresolvedProject } from "./opencode-project.js";

/** The two model roles an import uses; absent in a dry run or when the step is skipped. */
export interface HistoryImportModels {
  capture?: CaptureSummaryProvider;
  profile?: ModelPort;
}

export interface HistoryImportRun {
  /** Directory that relative paths and the default project resolve against. */
  cwd: string;
  models: HistoryImportModels;
  onProgress?: (processed: number, total: number, promptPreview: string) => void;
  signal?: AbortSignal;
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

/** Run one host's history import with already-parsed, validated arguments. */
export async function runHistoryImport(
  host: ImportHost,
  args: HistoryImportArgs,
  run: HistoryImportRun
): Promise<HistoryImportReport> {
  const at = (path: string) => resolve(run.cwd, path);
  const project = args.scope === "current-project" ? at(args.project ?? ".") : undefined;
  const pathMaps = args.pathMaps.map((map) => ({ from: map.from, to: at(map.to) }));
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

  const { importPiHistory } = await import("./importer.js");
  const { loadPiSessionForImport } = await import("./session-loader.js");
  return importPiHistory(
    {
      loadSession: loadPiSessionForImport,
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
    },
    {
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
    }
  );
}

/** The same plain-text report for every host and surface. */
export function formatHistoryImportReport(
  host: ImportHost,
  report: HistoryImportReport,
  model?: string
): string {
  const lines = [
    `${host === "pi" ? "Pi" : "OpenCode"} history import${report.dryRun ? " (dry-run)" : ""}`,
  ];
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
