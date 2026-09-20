import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initConfigWithLegacyMigration, isConfigured } from "../../config.js";
import { log } from "../../services/logger.js";
import { memoryClient } from "../../services/client.js";
import {
  importPiHistory,
  type ImportFilters,
  type ImportPathMap,
  type ImportReport,
} from "../../importer/importer.js";
import { loadPiSessionForImport } from "../../importer/session-loader.js";
import { createPiCaptureProvider, resolveModelFromContext } from "./provider.js";

/**
 * Pi command surface for the historical-session importer:
 *
 *   /memory-import-pi-history --dry-run
 *   /memory-import-pi-history
 *
 * Runs over the shared importer service. Extraction inherits the active Pi
 * model (or the piProvider/piModel override). Source session files are only
 * ever read.
 */

export const PI_IMPORT_COMMAND = "memory-import-pi-history";
export const PI_IMPORT_USAGE = `Usage: /${PI_IMPORT_COMMAND} [options]

Options:
  --dry-run                    Discover, map, and report; write nothing
  --force                      Reprocess units with terminal ledger states
  --scope=current-project      Import only sessions from this project (default)
  --scope=all-projects         Import every discovered session
  --session=<id-or-file>       Import one exact session
  --since=<date>               Only work units at/after this time
  --until=<date>               Only work units at/before this time
  --max-sessions=<n>           Limit discovery to the oldest n sessions
  --map=<oldPath>=<newPath>    Remap a recorded cwd that no longer exists
  --root=<dir>                 Session root (default ~/.pi/agent/sessions)

Dates accept ISO 8601 (2026-01-01, 2026-01-01T10:00:00Z) or epoch
milliseconds. --since/--until filter on each work unit's user-entry
timestamp, inclusive. Unresolvable recorded cwds are skipped and listed
in the report; use --map to import them into an existing directory.`;

export interface ParsedImportArgs {
  dryRun: boolean;
  force: boolean;
  scope: "current-project" | "all-projects";
  session?: string;
  since?: number;
  until?: number;
  maxSessions?: number;
  root?: string;
  pathMaps: ImportPathMap[];
  help: boolean;
  errors: string[];
}

function parseTimestamp(raw: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseImportArgs(raw: string): ParsedImportArgs {
  const result: ParsedImportArgs = {
    dryRun: false,
    force: false,
    scope: "current-project",
    pathMaps: [],
    help: false,
    errors: [],
  };

  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    if (token === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (token === "--force") {
      result.force = true;
      continue;
    }

    const equals = token.indexOf("=");
    const flag = equals === -1 ? token : token.slice(0, equals);
    const value = equals === -1 ? "" : token.slice(equals + 1);

    switch (flag) {
      case "--scope":
        if (value === "current-project" || value === "all-projects") {
          result.scope = value;
        } else {
          result.errors.push(`--scope must be current-project or all-projects, got "${value}"`);
        }
        break;
      case "--session":
        if (value) result.session = value;
        else result.errors.push("--session requires a value");
        break;
      case "--since":
        result.since = parseTimestamp(value);
        if (result.since === undefined)
          result.errors.push(`--since is not a valid date: "${value}"`);
        break;
      case "--until":
        result.until = parseTimestamp(value);
        if (result.until === undefined)
          result.errors.push(`--until is not a valid date: "${value}"`);
        break;
      case "--max-sessions": {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0) result.maxSessions = parsed;
        else result.errors.push(`--max-sessions must be a non-negative integer, got "${value}"`);
        break;
      }
      case "--root":
        if (value) result.root = value;
        else result.errors.push("--root requires a value");
        break;
      case "--map": {
        const separator = value.indexOf("=");
        if (separator > 0 && separator < value.length - 1) {
          result.pathMaps.push({
            from: value.slice(0, separator),
            to: value.slice(separator + 1),
          });
        } else {
          result.errors.push(`--map must be <oldPath>=<newPath>, got "${value}"`);
        }
        break;
      }
      default:
        result.errors.push(`Unknown option: "${token}"`);
    }
  }

  return result;
}

function formatReport(report: ImportReport): string {
  const lines = [
    `Pi history import ${report.dryRun ? "(dry-run)" : ""}`.trim(),
    `  sessions: ${report.sessionsLoaded} loaded, ${report.sessionsFilteredOut} filtered, ` +
      `${report.sessionsUnrecognized} unrecognized, ` +
      `${report.unresolvableSessions.length} unresolvable cwd`,
    `  work units: ${report.unitsTotal} total, ` +
      (report.dryRun
        ? `${report.unitsWouldImport} would import`
        : `${report.unitsImported} imported, ${report.unitsSkipped} skipped, ` +
          `${report.unitsFailed} failed`) +
      `, ${report.unitsAlreadyHandled} already handled`,
  ];
  for (const project of report.projects) {
    lines.push(
      `  project ${project.tag} (${project.sessions} sessions, ${project.units} units) -> ${project.directory}`
    );
  }
  if (report.loadErrors.length > 0) {
    lines.push(`  load errors: ${report.loadErrors.length}`);
  }
  return lines.join("\n");
}

let importCommandRunning = false;

export function registerPiHistoryImportCommand(
  pi: ExtensionAPI,
  getExtensionContext: () => ExtensionContext | null
): void {
  pi.registerCommand(PI_IMPORT_COMMAND, {
    description: "Import historical Pi sessions into the shared memory store (try --dry-run first)",
    handler: async (args: string, commandCtx) => {
      const notify = (message: string) => {
        if (getExtensionContext()?.hasUI) {
          getExtensionContext()?.ui.notify(message, "info");
        }
      };

      const parsed = parseImportArgs(args ?? "");
      if (parsed.help) {
        notify(PI_IMPORT_USAGE);
        return;
      }
      if (parsed.errors.length > 0) {
        notify(`memory-import-pi-history: ${parsed.errors.join("; ")}`);
        return;
      }

      const ctx = getExtensionContext();
      if (!ctx) {
        notify("memory-import-pi-history: no active Pi session context; open a session first");
        return;
      }
      if (!isConfigured()) {
        notify("memory-import-pi-history: memory system not configured");
        return;
      }
      if (importCommandRunning) {
        notify("memory-import-pi-history: an import is already running");
        return;
      }

      // Import against the current session's project and configuration.
      initConfigWithLegacyMigration(ctx.cwd);
      if (typeof commandCtx.waitForIdle === "function") {
        await commandCtx.waitForIdle();
      }

      importCommandRunning = true;
      try {
        // Best-effort warmup so failures surface as per-unit errors instead of
        // every unit failing on embedding initialisation.
        try {
          await memoryClient.warmup();
        } catch (error) {
          log("Pi import: memory warmup failed", { error: String(error) });
        }

        const filters: ImportFilters = {
          scope: parsed.scope,
          currentDirectory: ctx.cwd,
          ...(parsed.session !== undefined ? { session: parsed.session } : {}),
          ...(parsed.since !== undefined ? { since: parsed.since } : {}),
          ...(parsed.until !== undefined ? { until: parsed.until } : {}),
          ...(parsed.maxSessions !== undefined ? { maxSessions: parsed.maxSessions } : {}),
          ...(parsed.root !== undefined ? { root: parsed.root } : {}),
          ...(parsed.force ? { force: true } : {}),
          ...(parsed.dryRun ? { dryRun: true } : {}),
          pathMaps: parsed.pathMaps,
        };

        const provider = createPiCaptureProvider(() => resolveModelFromContext(ctx));

        let lastProgressNotify = 0;
        const report = await importPiHistory(
          {
            loadSession: loadPiSessionForImport,
            provider,
            onProgress: (processed, total, promptPreview) => {
              if (processed - lastProgressNotify >= 25 || processed === total) {
                lastProgressNotify = processed;
                notify(`Pi import: ${processed}/${total} units (${promptPreview})`);
              }
            },
          },
          filters
        );

        log("Pi history import report", { report });
        notify(formatReport(report));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("Pi history import failed", { error: message });
        notify(`memory-import-pi-history failed: ${message}`);
      } finally {
        importCommandRunning = false;
      }
    },
  });
}
