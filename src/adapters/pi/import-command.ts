import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initConfig, initConfigWithLegacyMigration, isConfigured } from "../../config.js";
import { log } from "../../services/logger.js";
import { memoryClient } from "../../services/client.js";
import {
  historyImportUsage,
  importNeedsModel,
  parseHistoryImportArgs,
  tokenizeImportArgs,
  type HistoryImportArgs,
} from "../../importer/import-args.js";
import {
  formatHistoryImportReport,
  summarizeHistoryImportReport,
  runHistoryImport,
} from "../../importer/run-import.js";
import { createPiCaptureProvider, resolveImportModel } from "./provider.js";
import { adaptPiProfileModel } from "./profile.js";

/**
 * Pi command surface for the historical-session importer:
 *
 *   /memory-import-pi-history --dry-run
 *   /memory-import-pi-history
 *
 * Runs over the shared importer service with the same options as the OpenCode
 * command and the CLI. Extraction uses this session's current model, or
 * `--model provider/id` from Pi's signed-in models. Source session files are
 * only ever read.
 */

export const PI_IMPORT_COMMAND = "memory-import-pi-history";
export const PI_IMPORT_USAGE = historyImportUsage("pi", "session");

export function parseImportArgs(raw: string): HistoryImportArgs {
  return parseHistoryImportArgs(tokenizeImportArgs(raw), { host: "pi", surface: "session" });
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

      // A dry-run must not trigger the one-time storage migration.
      if (parsed.dryRun) initConfig(ctx.cwd);
      else initConfigWithLegacyMigration(ctx.cwd);
      if (typeof commandCtx.waitForIdle === "function") {
        await commandCtx.waitForIdle();
      }
      // The command context carries the live session model; fall back to the
      // last session context for hosts whose command context lacks a registry.
      const modelCtx = commandCtx?.modelRegistry ? commandCtx : ctx;
      const selectedModel =
        parsed.model || importNeedsModel(parsed)
          ? resolveImportModel(modelCtx, parsed.model)
          : null;
      if ((parsed.model || importNeedsModel(parsed)) && !selectedModel) {
        notify(
          parsed.model
            ? `memory-import-pi-history: model not found: ${parsed.model}`
            : "memory-import-pi-history: this session has no model; pass --model provider/id"
        );
        return;
      }

      importCommandRunning = true;
      try {
        // Best-effort warmup so failures surface as per-unit errors instead of
        // every unit failing on embedding initialisation.
        if (!parsed.dryRun) {
          try {
            await memoryClient.warmup();
          } catch (error) {
            log("Pi import: memory warmup failed", { error: String(error) });
          }
        }

        let lastProgressNotify = 0;
        const report = await runHistoryImport("pi", parsed, {
          cwd: ctx.cwd,
          models:
            selectedModel && !parsed.dryRun
              ? {
                  capture: createPiCaptureProvider(() => selectedModel),
                  profile: adaptPiProfileModel(selectedModel),
                }
              : {},
          onProgress: (processed, total, promptPreview) => {
            if (processed - lastProgressNotify >= 25 || processed === total) {
              lastProgressNotify = processed;
              notify(`Pi import: ${processed}/${total} units (${promptPreview})`);
            }
          },
        });

        log("Pi history import report", summarizeHistoryImportReport(report));
        notify(
          formatHistoryImportReport(
            "pi",
            report,
            selectedModel ? `${selectedModel.provider}/${selectedModel.modelId}` : undefined
          )
        );
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
