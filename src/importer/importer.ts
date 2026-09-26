import { existsSync } from "node:fs";
import { captureConversation } from "../core/capture.js";
import type { CaptureConversation, CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import type { ProfileImportReport } from "./profile-import.js";
import { memoryClient } from "../services/client.js";
import { extractScopeFromContainerTag } from "../services/memory-scope.js";
import { getTags } from "../services/tags.js";
import { tursoConnectionManager } from "../services/turso/connection-manager.js";
import { tursoShardManager } from "../services/turso/shard-manager.js";
import {
  extractPiConversationWindows,
  type PiConversationWindow,
  type PiSessionEntry,
} from "../adapters/pi/conversation.js";
import { discoverPiSessions } from "./discovery.js";
import { PiImportLedger, importLedgerDbPath, type ImportLedgerRow } from "./ledger.js";
import type { LoadedPiSession } from "./session-loader.js";
import type { MemoryHost } from "../types/index.js";

/**
 * Historical-session import orchestration for both hosts.
 *
 * The shared source pipeline handles capture and ledger reconciliation.
 * The Pi adapter discovers sessions and selects conversation windows.
 */

export interface ImportPathMap {
  from: string;
  to: string;
}

export interface ImportFilters {
  scope: "current-project" | "all-projects";
  currentDirectory: string;
  session?: string;
  /** Inclusive lower bound on the work unit's user-entry timestamp (epoch ms). */
  since?: number;
  /** Inclusive upper bound on the work unit's user-entry timestamp (epoch ms). */
  until?: number;
  maxSessions?: number;
  force?: boolean;
  dryRun?: boolean;
  pathMaps?: ImportPathMap[];
  root?: string;
}

export type ImportUnitStatus =
  "imported" | "would-import" | "skipped" | "failed" | "already-handled";

export interface ImportUnitReport {
  key: string;
  sessionId: string;
  userEntryId: string;
  promptPreview: string;
  status: ImportUnitStatus;
  reason?: string;
  memoryId?: string;
}

export interface ImportProjectReport {
  tag: string;
  hash: string;
  directory: string;
  sessions: number;
  units: number;
}

export interface ImportReport {
  dryRun: boolean;
  root: string;
  sessionsDiscovered: number;
  sessionsLoaded: number;
  sessionsFilteredOut: number;
  sessionsUnrecognized: number;
  unresolvableSessions: Array<{ file: string; cwd: string | null }>;
  loadErrors: Array<{ file: string; error: string }>;
  unitsTotal: number;
  unitsImported: number;
  unitsWouldImport: number;
  unitsSkipped: number;
  unitsFailed: number;
  unitsAlreadyHandled: number;
  skipReasons: Record<string, number>;
  projects: ImportProjectReport[];
  units: ImportUnitReport[];
  profile?: ProfileImportReport;
}

export interface ImporterDeps {
  loadSession: (file: string) => LoadedPiSession;
  provider: CaptureSummaryProvider;
  onProgress?: (processed: number, total: number, promptPreview: string) => void;
  ledger?: PiImportLedger;
  profile?: { model?: ModelPort; batchSize?: number };
}

export interface ImportWindow extends CaptureConversation {
  userEntryId: string;
  userPrompt: string;
  userTimestamp?: number;
}

export interface ImportSourceSession {
  sessionId: string;
  directory: string;
  sourceFile: string;
  units: ImportWindow[];
}

export function buildImportKey(
  sessionId: string,
  window: ImportWindow,
  host = "pi"
): string | null {
  const terminalEntryId = window.sourceEntryIds?.[window.sourceEntryIds.length - 1];
  if (!terminalEntryId) return null;
  return `${host}:${sessionId}:${window.userEntryId}:${terminalEntryId}`;
}

/**
 * Find a stored memory by its deterministic import identity. Used to
 * reconcile crash windows: the memory insert landed but the ledger update did
 * not commit.
 */
export async function findMemoryIdByImportId(
  projectHash: string,
  importId: string
): Promise<string | null> {
  const shards = await tursoShardManager.getAllShards("project", projectHash);
  const escaped = importId.replace(/[\\%_]/g, (char) => `\\${char}`);
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const row = await db.get(`SELECT id FROM memories WHERE metadata LIKE ? ESCAPE '\\'`, [
      `%"importId":"${escaped}"%`,
    ]);
    if (row) return String(row.id);
  }
  return null;
}

function resolveSessionDirectory(cwd: string | null, pathMaps: ImportPathMap[]): string | null {
  if (!cwd) return null;
  const mapped = pathMaps.find((map) => map.from === cwd)?.to;
  const directory = mapped ?? cwd;
  return existsSync(directory) ? directory : null;
}

function preview(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed;
}

function windowWithinDateRange(
  window: ImportWindow,
  filters: Pick<ImportFilters, "since" | "until">
): boolean {
  if (window.userTimestamp === undefined) return true;
  if (filters.since !== undefined && window.userTimestamp < filters.since) return false;
  if (filters.until !== undefined && window.userTimestamp > filters.until) return false;
  return true;
}

async function lookupExistingMemory(
  projectHash: string,
  key: string,
  options: { storageAccessible: boolean }
): Promise<string | null> {
  if (!options.storageAccessible) return null;
  try {
    return await findMemoryIdByImportId(projectHash, key);
  } catch {
    return null;
  }
}

/** Process host-labelled work units through the shared capture and ledger pipeline. */
export async function importHistorySource(
  source: AsyncIterable<ImportSourceSession> | Iterable<ImportSourceSession>,
  host: MemoryHost,
  deps: Pick<ImporterDeps, "provider" | "ledger" | "onProgress">,
  filters: Pick<ImportFilters, "dryRun" | "force" | "since" | "until">,
  report: ImportReport
): Promise<void> {
  const dryRun = Boolean(filters.dryRun);
  const ledger = deps.ledger ?? new PiImportLedger();
  const ledgerFileExists = existsSync(importLedgerDbPath());
  const ledgerAccessible = !dryRun || ledgerFileExists;
  if (ledgerAccessible) await ledger.get("__warmup__");

  if (!dryRun) {
    const embeddingInitError = memoryClient.getEmbeddingInitError?.();
    if (embeddingInitError) {
      throw new Error(
        `Memory system is not ready for import: ${embeddingInitError}. Start the extension and retry.`
      );
    }
  }

  const candidates: Array<ImportSourceSession & { hash: string; window: ImportWindow }> = [];
  for await (const session of source) {
    const { hash } = extractScopeFromContainerTag(getTags(session.directory).project.tag);
    for (const window of session.units) {
      if (!windowWithinDateRange(window, filters)) continue;
      if (!buildImportKey(session.sessionId, window, host)) continue;
      candidates.push({ ...session, hash, window });
    }
  }
  report.unitsTotal = candidates.length;

  const storageAccessible = ledgerFileExists;
  let processed = 0;

  for (const candidate of candidates) {
    const { sessionId, directory, sourceFile, hash, window } = candidate;
    const key = buildImportKey(sessionId, window, host)!;
    processed++;
    deps.onProgress?.(processed, report.unitsTotal, preview(window.userPrompt));

    const unit: ImportUnitReport = {
      key,
      sessionId: sessionId,
      userEntryId: window.userEntryId,
      promptPreview: preview(window.userPrompt),
      status: "would-import",
    };

    const existing: ImportLedgerRow | null = ledgerAccessible ? await ledger.get(key) : null;

    const terminalHandled =
      existing &&
      (existing.status === "imported" || existing.status === "skipped") &&
      !filters.force;

    if (terminalHandled) {
      unit.status = "already-handled";
      unit.reason = existing.status;
      report.unitsAlreadyHandled++;
      report.units.push(unit);
      continue;
    }

    // Crash reconciliation: the memory landed but the ledger never committed.
    const storedMemoryId = await lookupExistingMemory(hash, key, { storageAccessible });
    if (storedMemoryId) {
      if (!dryRun) {
        await ledger.complete(key, storedMemoryId);
      }
      unit.status = "already-handled";
      unit.reason = "reconciled";
      unit.memoryId = storedMemoryId;
      report.unitsAlreadyHandled++;
      report.units.push(unit);
      continue;
    }

    if (dryRun) {
      report.unitsWouldImport++;
      report.units.push(unit);
      continue;
    }

    await ledger.begin({
      key,
      sessionId: sessionId,
      sourceFile: sourceFile,
      projectHash: hash,
    });

    try {
      const result = await captureConversation(
        {
          host,
          hostSessionId: sessionId,
          sourceType: "history-import",
          projectDirectory: directory,
          userPrompt: window.userPrompt,
          promptId: window.userEntryId,
          textResponses: window.textResponses,
          toolCalls: window.toolCalls,
          sourceEntryIds: window.sourceEntryIds,
          ...(window.userTimestamp !== undefined
            ? { sourceTimestamp: window.userTimestamp }
            : window.sourceTimestamp !== undefined
              ? { sourceTimestamp: window.sourceTimestamp }
              : {}),
          sourceFile: sourceFile,
          importId: key,
        },
        deps.provider
      );

      if (result.status === "skipped") {
        await ledger.skip(key, `extractor-skip:${result.type ?? "unknown"}`);
        unit.status = "skipped";
        unit.reason = `extractor-skip:${result.type ?? "unknown"}`;
        report.unitsSkipped++;
        const reason = unit.reason!;
        report.skipReasons[reason] = (report.skipReasons[reason] ?? 0) + 1;
      } else {
        await ledger.complete(key, result.memoryId);
        unit.status = "imported";
        unit.memoryId = result.memoryId;
        report.unitsImported++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ledger.fail(key, message);
      unit.status = "failed";
      unit.reason = message;
      report.unitsFailed++;
    }

    report.units.push(unit);
  }
}

export async function importPiHistory(
  deps: ImporterDeps,
  filters: ImportFilters
): Promise<ImportReport> {
  const dryRun = Boolean(filters.dryRun);
  const pathMaps = filters.pathMaps ?? [];

  const currentTag =
    filters.scope === "current-project" ? getTags(filters.currentDirectory).project.tag : null;

  const discovery = discoverPiSessions({ root: filters.root, maxSessions: filters.maxSessions });

  const report: ImportReport = {
    dryRun,
    root: filters.root ?? "",
    sessionsDiscovered: discovery.sessions.length,
    sessionsLoaded: 0,
    sessionsFilteredOut: 0,
    sessionsUnrecognized: discovery.unrecognized.length,
    unresolvableSessions: [],
    loadErrors: [],
    unitsTotal: 0,
    unitsImported: 0,
    unitsWouldImport: 0,
    unitsSkipped: 0,
    unitsFailed: 0,
    unitsAlreadyHandled: 0,
    skipReasons: {},
    projects: [],
    units: [],
  };

  const projectAggregates = new Map<
    string,
    { tag: string; hash: string; directory: string; sessions: Set<string>; units: number }
  >();

  interface CandidateUnit {
    session: LoadedPiSession;
    directory: string;
    tag: string;
    hash: string;
    window: PiConversationWindow;
  }
  const candidates: CandidateUnit[] = [];

  for (const discovered of discovery.sessions) {
    if (filters.session) {
      const wanted = filters.session;
      if (discovered.sessionId !== wanted && discovered.file !== wanted) {
        report.sessionsFilteredOut++;
        continue;
      }
    }

    let session: LoadedPiSession;
    try {
      session = deps.loadSession(discovered.file);
    } catch (error) {
      report.loadErrors.push({
        file: discovered.file,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const directory = resolveSessionDirectory(session.cwd, pathMaps);
    if (!directory) {
      report.unresolvableSessions.push({ file: session.sourceFile, cwd: session.cwd });
      continue;
    }

    const tags = getTags(directory);
    if (currentTag && tags.project.tag !== currentTag) {
      report.sessionsFilteredOut++;
      continue;
    }

    const { hash } = extractScopeFromContainerTag(tags.project.tag);
    report.sessionsLoaded++;

    let aggregate = projectAggregates.get(tags.project.tag);
    if (!aggregate) {
      aggregate = {
        tag: tags.project.tag,
        hash,
        directory,
        sessions: new Set(),
        units: 0,
      };
      projectAggregates.set(tags.project.tag, aggregate);
    }
    aggregate.sessions.add(session.sessionId);

    const windows = extractPiConversationWindows(session.branch as PiSessionEntry[]);
    for (const window of windows) {
      if (!windowWithinDateRange(window, filters)) continue;
      const key = buildImportKey(session.sessionId, window);
      if (!key) continue;
      candidates.push({ session, directory, tag: tags.project.tag, hash, window });
      aggregate.units++;
    }
  }

  // One source session per Pi session, so tags resolve once rather than per window.
  const grouped = new Map<string, ImportSourceSession>();
  for (const { session, directory, window } of candidates) {
    const key = `${session.sessionId}\0${session.sourceFile}`;
    const entry = grouped.get(key);
    if (entry) {
      entry.units.push(window);
    } else {
      grouped.set(key, {
        sessionId: session.sessionId,
        directory,
        sourceFile: session.sourceFile,
        units: [window],
      });
    }
  }
  const sourceSessions = [...grouped.values()];

  await importHistorySource(sourceSessions, "pi", deps, filters, report);

  report.projects = [...projectAggregates.values()].map((aggregate) => ({
    tag: aggregate.tag,
    hash: aggregate.hash,
    directory: aggregate.directory,
    sessions: aggregate.sessions.size,
    units: aggregate.units,
  }));

  if (deps.profile) {
    const { importProfileFromHistory } = await import("./profile-import.js");
    report.profile = await importProfileFromHistory(sourceSessions, {
      host: "pi",
      dryRun,
      model: deps.profile.model,
      batchSize: deps.profile.batchSize,
    });
  }

  return report;
}
