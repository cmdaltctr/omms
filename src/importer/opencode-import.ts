import type { CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import { getTags } from "../services/tags.js";
import { extractScopeFromContainerTag } from "../services/memory-scope.js";
import {
  countImportableUnits,
  importHistorySource,
  projectFilterTag,
  selectImportWindows,
  type ImportPathMap,
  type ImportProjectReport,
  type ImportReport,
  type ImportSourceSession,
} from "./importer.js";
import { resolveImportProject } from "./import-project.js";
import type { UnresolvedProject } from "./opencode-project.js";
import {
  DEFAULT_OPENCODE_DB,
  openOpencodeHistory,
  type OpencodeOpenOptions,
  type OpencodeSessionMeta,
} from "./opencode-reader.js";
import { importProfileFromHistory, type ProfileImportReport } from "./profile-import.js";

export { DEFAULT_OPENCODE_DB };

export interface OpencodeImportOptions {
  dbPath?: string;
  dryRun?: boolean;
  since?: number;
  until?: number;
  session?: string;
  /** Web selection by session ID; never combined with `session` or `maxSessions`. */
  selectionKeys?: string[];
  /** Web selection: user turns after this epoch ms are held back for a later run. */
  cutoff?: number;
  /** Web jobs share the listing's snapshot of a live database. */
  snapshot?: OpencodeOpenOptions["shared"];
  project?: string;
  maxSessions?: number;
  pathMaps?: ImportPathMap[];
  force?: boolean;
  skipMemories?: boolean;
  skipProfile?: boolean;
  profileBatch?: number;
  provider?: CaptureSummaryProvider;
  profileModel?: ModelPort;
  /** Profile batches done and planned, during the profile step. */
  onProfileProgress?: (done: number, total: number) => void;
  /** `alreadyHandled`: units found already done so far, which need no model call. */
  onProgress?: (
    processed: number,
    total: number,
    promptPreview: string,
    alreadyHandled?: number
  ) => void;
  signal?: AbortSignal;
}

export interface OpencodeImportReport extends ImportReport {
  childSessionsFolded: number;
  unresolvedProjects: UnresolvedProject[];
  profile?: ProfileImportReport;
}

/** Let the web server and live capture run between sessions of a long read. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Import resolved OpenCode history through the shared memory and profile steps. */
export async function importOpencodeHistory(
  options: OpencodeImportOptions
): Promise<OpencodeImportReport> {
  if (!options.dryRun && !options.skipMemories && !options.provider) {
    throw new Error("OpenCode history import needs a capture model");
  }
  if (!options.dryRun && !options.skipProfile && !options.profileModel) {
    throw new Error("OpenCode history import needs a profile model");
  }
  const dbPath = options.dbPath ?? DEFAULT_OPENCODE_DB;
  const projectTag = options.project ? projectFilterTag(options.project) : null;
  const history = await openOpencodeHistory(
    dbPath,
    {
      ...(options.since !== undefined ? { since: options.since } : {}),
      ...(options.until !== undefined ? { until: options.until } : {}),
      ...(options.session ? { session: options.session } : {}),
      ...(options.selectionKeys ? { sessionIds: options.selectionKeys } : {}),
      ...(options.maxSessions ? { maxSessions: options.maxSessions } : {}),
    },
    {
      ...(options.snapshot ? { shared: options.snapshot } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }
  );
  try {
    const unresolved = new Map<string, UnresolvedProject>();
    const projects = new Map<string, ImportProjectReport & { sessionIds: Set<string> }>();
    const selected: Array<OpencodeSessionMeta & { directory: string }> = [];
    let filtered = 0;
    for (const session of history.sessions) {
      const { directory } = resolveImportProject(
        session.recordedDirectory,
        options.pathMaps ?? [],
        session.projectWorktree
      );
      if (!directory) {
        const entry = unresolved.get(session.recordedDirectory) ?? {
          directory: session.recordedDirectory,
          sessions: 0,
          units: 0,
        };
        entry.sessions++;
        entry.units += history.loadUnits(session.sessionId).length;
        unresolved.set(entry.directory, entry);
        continue;
      }
      if (projectTag && projectTag !== projectFilterTag(directory)) {
        filtered++;
        continue;
      }
      selected.push({ ...session, directory });
    }

    const build = (session: (typeof selected)[number]) => {
      const windows = selectImportWindows(history.loadUnits(session.sessionId), options);
      const source: ImportSourceSession = {
        sessionId: session.sessionId,
        directory: session.directory,
        sourceFile: dbPath,
        units: windows.kept,
      };
      return { source, windows };
    };

    // Counting pass: totals for progress and the report, one session in memory at a time.
    let total = 0;
    let kept = 0;
    let heldBack = 0;
    let untimed = 0;
    for (const session of selected) {
      if (options.signal?.aborted) break;
      const { source, windows } = build(session);
      const info = getTags(session.directory).project;
      const project = projects.get(info.tag) ?? {
        tag: info.tag,
        hash: extractScopeFromContainerTag(info.tag).hash,
        directory: session.directory,
        sessions: 0,
        units: 0,
        sessionIds: new Set<string>(),
      };
      project.sessionIds.add(session.sessionId);
      project.sessions = project.sessionIds.size;
      project.units += windows.kept.length;
      projects.set(info.tag, project);
      total += countImportableUnits(source, "opencode", options);
      kept += windows.kept.length;
      heldBack += windows.heldBack;
      untimed += windows.untimed;
      await yieldToEventLoop();
    }

    const open = () =>
      (async function* () {
        for (const session of selected) {
          if (options.signal?.aborted) return;
          await yieldToEventLoop();
          yield build(session).source;
        }
      })();

    const report: OpencodeImportReport = {
      dryRun: Boolean(options.dryRun),
      root: dbPath,
      sessionsDiscovered: history.topLevelSessions,
      sessionsLoaded: selected.length,
      sessionsFilteredOut: filtered,
      sessionsUnrecognized: 0,
      unresolvableSessions: [],
      loadErrors: [],
      unitsTotal: 0,
      unitsImported: 0,
      unitsWouldImport: 0,
      unitsSkipped: 0,
      unitsFailed: 0,
      unitsAlreadyHandled: 0,
      unitsHeldBack: heldBack,
      unitsUntimed: untimed,
      skipReasons: {},
      units: [],
      projects: [...projects.values()].map(({ sessionIds: _ids, ...project }) => project),
      childSessionsFolded: history.childSessions,
      unresolvedProjects: [...unresolved.values()],
    };
    if (!options.skipMemories) {
      await importHistorySource(
        { total, open },
        "opencode",
        {
          provider: options.provider ?? {
            summarize: async () => {
              throw new Error("A dry-run cannot call the capture model");
            },
          },
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        },
        options,
        report
      );
    } else {
      report.unitsTotal = kept;
    }
    if (!options.skipProfile && !options.signal?.aborted) {
      report.profile = await importProfileFromHistory(open(), {
        host: "opencode",
        signal: options.signal,
        dryRun: options.dryRun,
        batchSize: options.profileBatch,
        model: options.profileModel,
        ...(options.onProfileProgress ? { onProgress: options.onProfileProgress } : {}),
      });
    }
    return report;
  } finally {
    await history.close();
  }
}
