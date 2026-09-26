import { homedir } from "node:os";
import { join } from "node:path";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import { getTags } from "../services/tags.js";
import { extractScopeFromContainerTag } from "../services/memory-scope.js";
import {
  importHistorySource,
  projectFilterTag,
  type ImportPathMap,
  type ImportProjectReport,
  type ImportReport,
} from "./importer.js";
import { resolveOpencodeSessions, type UnresolvedProject } from "./opencode-project.js";
import { readOpencodeHistory, type OpencodeSourceSession } from "./opencode-reader.js";
import { importProfileFromHistory, type ProfileImportReport } from "./profile-import.js";

export interface OpencodeImportOptions {
  dbPath?: string;
  dryRun?: boolean;
  since?: number;
  until?: number;
  session?: string;
  project?: string;
  maxSessions?: number;
  pathMaps?: ImportPathMap[];
  force?: boolean;
  skipMemories?: boolean;
  skipProfile?: boolean;
  profileBatch?: number;
  provider?: CaptureSummaryProvider;
  profileModel?: ModelPort;
}

export interface OpencodeImportReport extends ImportReport {
  childSessionsFolded: number;
  unresolvedProjects: UnresolvedProject[];
  profile?: ProfileImportReport;
}

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
  const dbPath = options.dbPath ?? join(homedir(), ".local/share/opencode/opencode.db");
  // Resolve the filter before opening the reader: the reader only closes once iterated.
  const projectTag = options.project ? projectFilterTag(options.project) : null;
  const reader = readOpencodeHistory(dbPath, options);
  const unresolved = new Map<string, UnresolvedProject>();
  const sessions: OpencodeSourceSession[] = [];
  const projects = new Map<string, ImportProjectReport & { sessionIds: Set<string> }>();
  let filtered = 0;
  for await (const session of resolveOpencodeSessions(
    reader.sessions,
    options.pathMaps ?? [],
    unresolved
  )) {
    const info = getTags(session.directory).project;
    if (projectTag && projectTag !== projectFilterTag(session.directory)) {
      filtered++;
      continue;
    }
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
    project.units += session.units.length;
    projects.set(info.tag, project);
    sessions.push(session);
  }
  const report: OpencodeImportReport = {
    dryRun: Boolean(options.dryRun),
    root: dbPath,
    sessionsDiscovered: reader.topLevelSessions,
    sessionsLoaded: sessions.length,
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
    skipReasons: {},
    units: [],
    projects: [...projects.values()].map(({ sessionIds: _ids, ...project }) => project),
    childSessionsFolded: reader.childSessions,
    unresolvedProjects: [...unresolved.values()],
  };
  if (!options.skipMemories) {
    await importHistorySource(
      sessions,
      "opencode",
      {
        provider: options.provider ?? {
          summarize: async () => {
            throw new Error("A dry-run cannot call the capture model");
          },
        },
      },
      options,
      report
    );
  } else {
    report.unitsTotal = sessions.reduce((total, session) => total + session.units.length, 0);
  }
  if (!options.skipProfile) {
    report.profile = await importProfileFromHistory(sessions, {
      host: "opencode",
      dryRun: options.dryRun,
      batchSize: options.profileBatch,
      model: options.profileModel,
    });
  }
  return report;
}
