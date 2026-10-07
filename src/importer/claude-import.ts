import {
  importHistorySource,
  type ImportFilters,
  type ImporterDeps,
  type ImportReport,
} from "./importer.js";
import { openClaudeHistorySource, type ClaudeHistoryDeps } from "./claude-reader.js";

export interface ClaudeImportReport extends ImportReport {
  /** Transcript lines that were not JSON entries. */
  unreadableLines: number;
  /** Entries of a type the reader does not know. */
  unknownTypes: number;
}

export type ClaudeImportDeps = Pick<
  ImporterDeps,
  "provider" | "ledger" | "onProgress" | "signal" | "profile"
> &
  ClaudeHistoryDeps;

/**
 * Import Claude Code history through the shared capture, ledger, and profile
 * steps, with host `claude-code`. Mirrors `importPiHistory`: the same filters,
 * report, and dry-run rules.
 */
export async function importClaudeHistory(
  deps: ClaudeImportDeps,
  filters: ImportFilters
): Promise<ClaudeImportReport> {
  const source = await openClaudeHistorySource(
    {
      ...(filters.root !== undefined ? { root: filters.root } : {}),
      ...(filters.since !== undefined ? { since: filters.since } : {}),
      ...(filters.until !== undefined ? { until: filters.until } : {}),
      ...(filters.cutoff !== undefined ? { cutoff: filters.cutoff } : {}),
      ...(filters.session ? { session: filters.session } : {}),
      ...(filters.selectionKeys ? { selectionKeys: filters.selectionKeys } : {}),
      ...(filters.maxSessions !== undefined ? { maxSessions: filters.maxSessions } : {}),
      ...(filters.pathMaps ? { pathMaps: filters.pathMaps } : {}),
      ...(filters.scope === "current-project" ? { project: filters.currentDirectory } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
    },
    deps.loadSession ? { loadSession: deps.loadSession } : {}
  );

  const report: ClaudeImportReport = {
    dryRun: Boolean(filters.dryRun),
    root: filters.root ?? "",
    sessionsDiscovered: source.sessionsDiscovered,
    sessionsLoaded: source.sessionsLoaded,
    sessionsFilteredOut: source.sessionsFilteredOut,
    sessionsUnrecognized: source.unrecognized.length,
    unresolvableSessions: source.unresolvableSessions,
    // Shared with the source, so a session that fails in `open()` is reported too.
    loadErrors: source.loadErrors,
    unitsTotal: 0,
    unitsImported: 0,
    unitsWouldImport: 0,
    unitsSkipped: 0,
    unitsFailed: 0,
    unitsAlreadyHandled: 0,
    skipReasons: {},
    projects: source.projects,
    units: [],
    unitsHeldBack: source.unitsHeldBack,
    unitsUntimed: source.unitsUntimed,
    unreadableLines: source.unreadableLines,
    unknownTypes: source.unknownTypes,
  };

  if (filters.skipMemories) {
    report.unitsTotal = source.unitsKept;
  } else {
    await importHistorySource(source, "claude-code", deps, filters, report);
  }

  if (deps.profile && !deps.signal?.aborted) {
    const { importProfileFromHistory } = await import("./profile-import.js");
    report.profile = await importProfileFromHistory(source.open(), {
      host: "claude-code",
      signal: deps.signal,
      dryRun: Boolean(filters.dryRun),
      force: Boolean(filters.force),
      model: deps.profile.model,
      batchSize: deps.profile.batchSize,
      ...(deps.profile.onProgress ? { onProgress: deps.profile.onProgress } : {}),
    });
  }

  return report;
}
