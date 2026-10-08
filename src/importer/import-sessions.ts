import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { discoverPiSessions } from "./discovery.js";
import type { HistoryImportArgs, ImportHost } from "./import-args.js";
import { resolveImportProject, type ProjectResolution } from "./import-project.js";
import {
  assertImportSourceUnchanged,
  importSourceKey,
  readImportSourceToken,
  validateImportSource,
  defaultImportSourcePath,
  type ImportSourceIdentity,
} from "./import-sources.js";
import type { ImportPathMap } from "./importer.js";

/**
 * Session metadata for the Settings page and the selection a job imports.
 * Both come from `matchImportSessions`, so the list, its revision, and the
 * imported set always use the same discovery and project rules.
 */

export const MAX_SELECTED_KEYS = 1000;
const MAX_PAGE = 200;

export interface ImportSessionRow {
  /**
   * Selection key: the OpenCode session ID, or the Pi or Claude Code file path
   * relative to the source.
   */
  key: string;
  sessionId: string | null;
  createdAt: number | null;
  recordedDirectory: string | null;
  directory: string | null;
  via: ProjectResolution;
}

export interface ImportMatchOptions {
  host: ImportHost;
  scope: HistoryImportArgs["scope"];
  /** Absolute project directory; defaults to the server's working directory. */
  project?: string;
  pathMaps: ImportPathMap[];
  cwd: string;
  /** Grouped imports can retain a valid source with no matching sessions as no-work. */
  allowEmpty?: boolean;
  signal?: AbortSignal;
}

export class StaleSelectionError extends Error {
  readonly status = 409;
  constructor(message = "The session list is out of date. Refresh the list and try again.") {
    super(message);
    this.name = "StaleSelectionError";
  }
}

interface Matched {
  identity: ImportSourceIdentity;
  /** Resolvable sessions in scope, newest first. */
  matching: ImportSessionRow[];
  /** Sessions whose directory cannot be resolved, in any scope. */
  unresolved: ImportSessionRow[];
  revision: string;
}

async function readRows(
  identity: ImportSourceIdentity,
  options: ImportMatchOptions,
  snapshotMode: "fresh" | "reuse" | "any"
): Promise<ImportSessionRow[]> {
  if (options.host === "pi") {
    return discoverPiSessions({ root: identity.realPath }).sessions.map((session) => ({
      key: session.key,
      sessionId: session.sessionId,
      createdAt: session.timestamp,
      recordedDirectory: session.cwd,
      ...resolveImportProject(session.cwd, options.pathMaps),
    }));
  }
  if (options.host === "claude-code") {
    // The reader loads the storage engine, so it stays out of this module's static imports.
    const { discoverClaudeSessions } = await import("./claude-reader.js");
    return discoverClaudeSessions({ root: identity.realPath }).sessions.map((session) => ({
      key: session.key,
      sessionId: session.sessionId,
      createdAt: session.timestamp,
      recordedDirectory: session.cwd,
      ...resolveImportProject(session.cwd, options.pathMaps),
    }));
  }
  const { openOpencodeHistory } = await import("./opencode-reader.js");
  const history = await openOpencodeHistory(
    identity.realPath,
    {},
    {
      shared: { key: importSourceKey(identity), mode: snapshotMode },
      ...(options.signal ? { signal: options.signal } : {}),
    }
  );
  try {
    return history.sessions.map((session) => ({
      key: session.sessionId,
      sessionId: session.sessionId,
      createdAt: session.timeCreated,
      recordedDirectory: session.recordedDirectory,
      ...resolveImportProject(session.recordedDirectory, options.pathMaps, session.projectWorktree),
    }));
  } finally {
    await history.close();
  }
}

/**
 * The revision covers the source, the options that decide membership, and the
 * sorted keys. It never uses file sizes or times: a live database changes on
 * every message, and new turns in a listed session do not change the set.
 */
function revisionOf(
  identity: ImportSourceIdentity,
  options: ImportMatchOptions,
  projectTag: string | null,
  keys: string[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        host: options.host,
        source: importSourceKey(identity),
        scope: options.scope,
        project: projectTag,
        maps: options.pathMaps,
        keys: [...keys].sort(),
      })
    )
    .digest("hex");
}

export async function matchImportSessions(
  identity: ImportSourceIdentity,
  options: ImportMatchOptions,
  snapshotMode: "fresh" | "reuse" | "any"
): Promise<Matched> {
  options.signal?.throwIfAborted();
  assertImportSourceUnchanged(identity);
  const { projectFilterTag } = await import("./importer.js");
  const projectTag =
    options.scope === "current-project"
      ? projectFilterTag(resolve(options.cwd, options.project ?? "."))
      : null;
  // Saved maps plus the request's own, as `runHistoryImport` uses them.
  // The revision hashes the same merged maps, so a saved-map change is seen as stale.
  const { runPathMaps } = await import("./import-path-maps.js");
  const merged = { ...options, pathMaps: await runPathMaps(options.pathMaps, options.cwd) };
  const rows = await readRows(identity, merged, snapshotMode);
  const unresolved = rows.filter((row) => row.directory === null);
  const matching = rows
    .filter((row) => row.directory !== null)
    .filter((row) => projectTag === null || projectFilterTag(row.directory!) === projectTag)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.key.localeCompare(b.key));
  return {
    identity,
    matching,
    unresolved,
    revision: revisionOf(
      identity,
      merged,
      projectTag,
      matching.map((row) => row.key)
    ),
  };
}

export interface ImportSessionPage {
  source: { kind: ImportSourceIdentity["kind"]; displayPath: string; sourceToken: string };
  total: number;
  offset: number;
  rows: Array<ImportSessionRow & { selectable: boolean }>;
  /** Sessions whose recorded directory no longer exists. */
  unresolvedCount: number;
  revision: string;
  listedAt: number;
}

export interface SessionListRequest {
  sourceToken?: unknown;
  offset?: number;
  limit?: number;
  refresh?: boolean;
  match: Omit<ImportMatchOptions, "cwd">;
}

/** Check a session-list request body from the page. */
export function validateSessionListRequest(value: unknown): SessionListRequest {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== "object") throw new Error("Invalid session list request");
  if (input.host !== "pi" && input.host !== "opencode" && input.host !== "claude-code") {
    throw new Error("Choose Pi, OpenCode, or Claude Code");
  }
  const scope = input.scope ?? "current-project";
  if (scope !== "current-project" && scope !== "all-projects") throw new Error("Invalid scope");
  const project = input.project;
  if (project !== undefined && (typeof project !== "string" || !isAbsolute(project))) {
    throw new Error("The project must be an absolute path");
  }
  const maps = input.pathMaps ?? [];
  if (
    !Array.isArray(maps) ||
    !maps.every(
      (map: unknown) =>
        map &&
        typeof (map as { from?: unknown }).from === "string" &&
        typeof (map as { to?: unknown }).to === "string"
    )
  ) {
    throw new Error("Invalid directory maps");
  }
  for (const key of ["offset", "limit"] as const) {
    if (input[key] !== undefined && !Number.isSafeInteger(input[key])) {
      throw new Error(`Invalid ${key}`);
    }
  }
  return {
    ...(input.source !== undefined ? { sourceToken: input.source } : {}),
    ...(input.offset !== undefined ? { offset: input.offset as number } : {}),
    ...(input.limit !== undefined ? { limit: input.limit as number } : {}),
    refresh: input.refresh === true,
    match: {
      host: input.host,
      scope,
      ...(project ? { project } : {}),
      pathMaps: maps as ImportPathMap[],
    },
  };
}

/** One page of session metadata; no prompts, replies, or tool data. */
export async function listImportSessions(
  request: {
    sourceToken?: unknown;
    offset?: number;
    limit?: number;
    refresh?: boolean;
  },
  options: ImportMatchOptions
): Promise<ImportSessionPage> {
  const source =
    request.sourceToken === undefined
      ? validateImportSource(
          options.host,
          defaultImportSourcePath(
            options.host,
            (await import("../config.js")).CONFIG.claudeConfigDir
          )
        )
      : null;
  const token = source?.sourceToken ?? request.sourceToken;
  const identity = readImportSourceToken(token, options.host);
  const offset = Math.max(0, Math.floor(request.offset ?? 0));
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(request.limit ?? 50)));
  // A refresh takes a fresh copy of a live database; paging reuses the current one.
  const listedAt = Date.now();
  const matched = await matchImportSessions(identity, options, request.refresh ? "fresh" : "any");
  // Feed the Directory maps list; a failure here must not break the listing.
  const { recordUnresolvedDirectories, summarizeUnresolvedDirectories } =
    await import("../services/backfill-state.js");
  await recordUnresolvedDirectories(
    options.host,
    summarizeUnresolvedDirectories(
      matched.unresolved.map((row) => ({ directory: row.recordedDirectory }))
    )
  ).catch(() => {});
  const rows = [
    ...matched.matching.map((row) => ({ ...row, selectable: true })),
    ...(options.scope === "all-projects"
      ? matched.unresolved.map((row) => ({ ...row, selectable: false }))
      : []),
  ];
  return {
    source: { kind: identity.kind, displayPath: identity.realPath, sourceToken: token as string },
    total: rows.length,
    offset,
    rows: rows.slice(offset, offset + limit),
    unresolvedCount: matched.unresolved.length,
    revision: matched.revision,
    listedAt,
  };
}

export type ImportSelection =
  | { mode: "ids"; sessions: Array<{ key: string; directory: string }>; listedAt: number }
  | { mode: "all"; excludedKeys: string[]; revision: string; listedAt: number };

export function validateImportSelection(value: unknown): ImportSelection {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== "object") throw new Error("Choose sessions to import");
  const listedAt = input.listedAt;
  if (typeof listedAt !== "number" || !Number.isFinite(listedAt) || listedAt > Date.now()) {
    throw new Error("Invalid listing time");
  }
  if (input.mode === "ids") {
    const sessions = input.sessions;
    if (
      !Array.isArray(sessions) ||
      sessions.length === 0 ||
      !sessions.every(
        (item: unknown) =>
          item &&
          typeof (item as { key?: unknown }).key === "string" &&
          typeof (item as { directory?: unknown }).directory === "string"
      )
    ) {
      throw new Error("Choose sessions to import");
    }
    if (sessions.length > MAX_SELECTED_KEYS) {
      throw new Error(
        `Select at most ${MAX_SELECTED_KEYS} sessions one by one, or use Select all matching`
      );
    }
    return {
      mode: "ids",
      sessions: sessions as Array<{ key: string; directory: string }>,
      listedAt,
    };
  }
  if (input.mode === "all") {
    const excluded = input.excludedKeys ?? [];
    if (!Array.isArray(excluded) || !excluded.every((key) => typeof key === "string")) {
      throw new Error("Invalid excluded sessions");
    }
    if (typeof input.revision !== "string") throw new Error("Invalid session list revision");
    return { mode: "all", excludedKeys: excluded as string[], revision: input.revision, listedAt };
  }
  throw new Error("Choose sessions to import");
}

export interface ResolvedImportSelection {
  identity: ImportSourceIdentity;
  keys: string[];
  cutoff: number;
  /** Source sessions still missing a project, excluding ignored directories; never import keys. */
  unresolvedCount?: number;
}

/**
 * Re-resolve a selection against the source right before a job. New sessions
 * make an "all" selection stale; a missing or re-projected session makes an
 * "ids" selection stale. Neither ever imports a session the user did not see.
 */
export async function resolveImportSelection(
  sourceToken: unknown,
  selection: ImportSelection,
  options: ImportMatchOptions
): Promise<ResolvedImportSelection> {
  options.signal?.throwIfAborted();
  const identity = readImportSourceToken(sourceToken, options.host);
  const matched = await matchImportSessions(identity, options, "reuse").catch((error: unknown) => {
    if ((error as { code?: string }).code === "expired") throw new StaleSelectionError();
    throw error;
  });
  let keys: string[];
  if (selection.mode === "all") {
    if (matched.revision !== selection.revision) throw new StaleSelectionError();
    const excluded = new Set(selection.excludedKeys);
    keys = matched.matching.map((row) => row.key).filter((key) => !excluded.has(key));
  } else {
    const current = new Map(matched.matching.map((row) => [row.key, row.directory]));
    for (const item of selection.sessions) {
      if (current.get(item.key) !== item.directory) throw new StaleSelectionError();
    }
    keys = selection.sessions.map((item) => item.key);
  }
  if (keys.length === 0 && !options.allowEmpty) throw new Error("Choose sessions to import");
  const { CONFIG } = await import("../config.js");
  const { visibleUnresolvedCount } = await import("../services/backfill-state.js");
  return {
    identity,
    keys,
    cutoff: selection.listedAt,
    unresolvedCount: visibleUnresolvedCount(
      matched.unresolved.length,
      matched.unresolved.map((row) => ({ directory: row.recordedDirectory ?? "", sessions: 1 })),
      CONFIG.importIgnoredDirectories ?? []
    ),
  };
}
