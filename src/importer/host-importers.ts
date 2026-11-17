import { closeSync, openSync, readSync, type Stats } from "node:fs";
import { dirname } from "node:path";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { SettingsModel } from "./backfill-controls.js";
import { claudeProjectsRoot } from "../services/claude-folder.js";
import type { MemoryHost } from "../shared/hosts.js";
import { DEFAULT_PI_SESSION_ROOT, discoverPiSessions, readPiSessionHeader } from "./discovery.js";
import type { HistoryImportArgs } from "./import-args.js";
import type { ImportReadiness } from "./import-readiness.js";
import type { ImportFilters, ImporterDeps, ImportPathMap } from "./importer.js";
import { DEFAULT_OPENCODE_DB } from "./opencode-reader.js";
import type { HistoryImportReport, HistoryImportRun } from "./run-import.js";

/**
 * Each host's history import parts: where its history lives, how a chosen
 * source is checked, how its sessions are listed, and how it is imported.
 * Host identity facts live in `src/shared/hosts.ts`. Readers that load the
 * storage engine stay behind `import()`. Callers pass config values in.
 */

export type ImportSourceKind = "pi-folder" | "pi-file" | "opencode-db" | "claude-projects";

/** One listed session before its project is resolved. */
export interface HostSessionRow {
  key: string;
  sessionId: string | null;
  createdAt: number | null;
  recordedDirectory: string | null;
  projectWorktree?: string | null;
  /** OpenCode only: the title the host stores. The session list removes private text. */
  title?: string | null;
}

/** What `runHistoryImport` hands a host's import after the shared set-up. */
export interface HostImportRun {
  args: HistoryImportArgs;
  run: HistoryImportRun;
  at: (path: string) => string;
  project: string | undefined;
  pathMaps: ImportPathMap[];
  capture: CaptureSummaryProvider;
  deps: Omit<ImporterDeps, "loadSession">;
  filters: ImportFilters;
  /** `CONFIG.claudeConfigDir`, read only when it is needed. */
  claudeConfigDir: () => Promise<string | undefined>;
}

export interface HostImporter {
  defaultSourcePath(claudeConfigDir?: string): string;
  /** The folder the source picker opens in when no path is given. */
  browseStart(claudeConfigDir?: string): string;
  /** The source's kind, or why the path cannot be this host's source. */
  sourceKind(realPath: string, info: Stats): { kind: ImportSourceKind } | { error: string };
  /** The picker's kind for a file, or null when the host cannot import it. */
  browseFileKind(name: string): "pi-file" | "opencode-db" | null;
  listSessions(
    source: { realPath: string; snapshotKey: string },
    snapshotMode: "fresh" | "reuse" | "any",
    signal?: AbortSignal
  ): Promise<HostSessionRow[]>;
  runImport(input: HostImportRun): Promise<HistoryImportReport>;
  /** Why this host's reader cannot run here, or null. */
  readerBlocked(readiness: ImportReadiness): string | null;
  /** The host records worktrees that can suggest a directory map. */
  worktreeHints: boolean;
  /** The Settings list of the host's signed-in models, or null when it lends no session model. */
  settingsModels:
    (() => Promise<{ available: boolean; models?: SettingsModel[]; reason?: string }>) | null;
}

function isSqliteFile(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(16);
    readSync(fd, buffer, 0, 16, 0);
    return buffer.toString("latin1") === "SQLite format 3\0";
  } finally {
    closeSync(fd);
  }
}

export const HOST_IMPORTERS: Record<MemoryHost, HostImporter> = {
  pi: {
    defaultSourcePath: () => DEFAULT_PI_SESSION_ROOT,
    browseStart: () => DEFAULT_PI_SESSION_ROOT,
    sourceKind(realPath, info) {
      if (info.isDirectory()) return { kind: "pi-folder" };
      if (info.isFile() && realPath.endsWith(".jsonl")) {
        if ("reason" in readPiSessionHeader(realPath, "")) {
          return { error: "The file is not a Pi session file" };
        }
        return { kind: "pi-file" };
      }
      return { error: "Choose a Pi sessions folder or one .jsonl session file" };
    },
    browseFileKind: (name) => (name.endsWith(".jsonl") ? "pi-file" : null),
    async listSessions(source) {
      return discoverPiSessions({ root: source.realPath }).sessions.map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        createdAt: session.timestamp,
        recordedDirectory: session.cwd,
      }));
    },
    async runImport({ deps, filters }) {
      const { importPiHistory } = await import("./importer.js");
      const { loadPiSessionForImport } = await import("./session-loader.js");
      return importPiHistory({ ...deps, loadSession: loadPiSessionForImport }, filters);
    },
    readerBlocked: (readiness) =>
      readiness.piReader.available
        ? null
        : (readiness.piReader.reason ?? "The Pi session reader is unavailable"),
    worktreeHints: false,
    settingsModels: async () => (await import("./settings-models.js")).listPiSettingsModels(),
  },
  opencode: {
    defaultSourcePath: () => DEFAULT_OPENCODE_DB,
    browseStart: () => dirname(DEFAULT_OPENCODE_DB),
    sourceKind(realPath, info) {
      if (!info.isFile() || !isSqliteFile(realPath)) {
        return { error: "Choose an OpenCode database file" };
      }
      return { kind: "opencode-db" };
    },
    browseFileKind: (name) => (name.endsWith(".db") ? "opencode-db" : null),
    async listSessions(source, snapshotMode, signal) {
      const { openOpencodeHistory } = await import("./opencode-reader.js");
      const history = await openOpencodeHistory(
        source.realPath,
        {},
        {
          shared: { key: source.snapshotKey, mode: snapshotMode },
          ...(signal ? { signal } : {}),
        }
      );
      try {
        return history.sessions.map((session) => ({
          key: session.sessionId,
          sessionId: session.sessionId,
          createdAt: session.timeCreated,
          title: session.title,
          recordedDirectory: session.recordedDirectory,
          projectWorktree: session.projectWorktree,
        }));
      } finally {
        await history.close();
      }
    },
    async runImport({ args, run, at, project, pathMaps, capture }) {
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
        skipSkills: args.skipSkills,
        ...(run.signal ? { signal: run.signal } : {}),
        ...(run.onProgress ? { onProgress: run.onProgress } : {}),
        ...(run.models.capture ? { provider: capture } : {}),
        ...(run.models.profile ? { profileModel: run.models.profile } : {}),
        ...(run.onProfileProgress ? { onProfileProgress: run.onProfileProgress } : {}),
        ...(run.onProfilePrompt ? { onProfilePrompt: run.onProfilePrompt } : {}),
      });
    },
    readerBlocked: () => null,
    worktreeHints: true,
    settingsModels: async () => (await import("./settings-models.js")).listOpencodeSettingsModels(),
  },
  "claude-code": {
    defaultSourcePath: (claudeConfigDir) => claudeProjectsRoot(claudeConfigDir),
    browseStart: (claudeConfigDir) => claudeProjectsRoot(claudeConfigDir),
    sourceKind(_realPath, info) {
      if (!info.isDirectory()) return { error: "Choose a Claude Code transcripts folder" };
      return { kind: "claude-projects" };
    },
    // A Claude Code source is always a folder, so the picker lists folders only.
    browseFileKind: () => null,
    async listSessions(source) {
      // The reader loads the storage engine, so it stays out of this module's static imports.
      const { discoverClaudeSessions } = await import("./claude-reader.js");
      return discoverClaudeSessions({ root: source.realPath }).sessions.map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        createdAt: session.timestamp,
        recordedDirectory: session.cwd,
      }));
    },
    async runImport({ args, deps, filters, claudeConfigDir }) {
      const { importClaudeHistory } = await import("./claude-import.js");
      if (args.source) return importClaudeHistory(deps, filters);
      // Without --root, read the folder live capture uses.
      return importClaudeHistory(deps, {
        ...filters,
        root: claudeProjectsRoot(await claudeConfigDir()),
      });
    },
    readerBlocked: () => null,
    worktreeHints: false,
    // Claude Code cannot lend a session model, so it has no list.
    settingsModels: null,
  },
};
