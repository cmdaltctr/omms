import { isConfigured } from "../../config.js";
import {
  historyImportUsage,
  importNeedsModel,
  parseHistoryImportArgs,
  tokenizeImportArgs,
} from "../../importer/import-args.js";
import {
  formatHistoryImportReport,
  summarizeHistoryImportReport,
  runHistoryImport,
} from "../../importer/run-import.js";
import { createOpencodeImportModels, type OpencodeModelRef } from "./opencode-import-models.js";
export { createOpencodeImportModels } from "./opencode-import-models.js";
export type { OpencodeModelRef } from "./opencode-import-models.js";
import { loadOpencodeProvider } from "./opencode-provider-loader.js";
import { beginManualImport } from "../../importer/manual-import-guard.js";
import { memoryClient } from "../../services/client.js";
import { log } from "../../services/logger.js";

/**
 * OpenCode command surface for the historical-session importer:
 *
 *   /memory-import-opencode-history --dry-run
 *   /memory-import-opencode-history
 *
 * The same options and model rules as Pi's command: this session's model by
 * default, or `--model provider/id` from OpenCode's connected providers. Model
 * calls go through OpenCode's own sign-in, so no omms API key is involved.
 */

export const OPENCODE_IMPORT_COMMAND = "memory-import-opencode-history";
export const OPENCODE_IMPORT_DESCRIPTION =
  "Import historical OpenCode sessions into the shared memory store (try --dry-run first)";
export const OPENCODE_IMPORT_USAGE = historyImportUsage("opencode", "session");

export interface OpencodeImportCommandInput {
  argsText: string;
  /** Session directory; relative paths and the default project resolve here. */
  directory: string;
  /** The model the invoking session currently uses, if the host can tell. */
  sessionModel: () => Promise<OpencodeModelRef | null>;
  notify?: (message: string) => void;
}

let importCommandRunning = false;

function splitModel(value: string): OpencodeModelRef {
  const separator = value.indexOf("/");
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

/** Parse, run, and describe one import; always resolves to text for the session. */
export async function runOpencodeImportCommand(input: OpencodeImportCommandInput): Promise<string> {
  const name = OPENCODE_IMPORT_COMMAND;
  // Some hosts pass the command name through with its arguments.
  const argsText = input.argsText.trim().replace(new RegExp(`^/?${name}(\\s|$)`), "");
  const parsed = parseHistoryImportArgs(tokenizeImportArgs(argsText), {
    host: "opencode",
    surface: "session",
  });
  if (parsed.help) return OPENCODE_IMPORT_USAGE;
  if (parsed.errors.length > 0) return `${name}: ${parsed.errors.join("; ")}`;
  if (!isConfigured()) return `${name}: memory system not configured`;
  if (importCommandRunning) return `${name}: an import is already running`;

  importCommandRunning = true;
  const endManualImport = beginManualImport("opencode");
  try {
    let ref: OpencodeModelRef | null = null;
    if (parsed.model || importNeedsModel(parsed)) {
      ref = parsed.model ? splitModel(parsed.model) : await input.sessionModel();
      if (!ref) return `${name}: this session has no model yet; pass --model provider/id`;
      const { isProviderConnected } = await loadOpencodeProvider();
      if (!isProviderConnected(ref.providerID)) {
        return `${name}: OpenCode provider "${ref.providerID}" is not connected`;
      }
    }
    const models = ref && !parsed.dryRun ? await createOpencodeImportModels(ref) : {};
    if (!parsed.dryRun) {
      try {
        await memoryClient.warmup();
      } catch (error) {
        log("OpenCode import: memory warmup failed", { error: String(error) }, "error");
      }
    }

    let lastProgress = 0;
    const report = await runHistoryImport("opencode", parsed, {
      cwd: input.directory,
      models,
      track: { surface: "slash" },
      onProgress: (processed, total, promptPreview) => {
        if (processed - lastProgress >= 25 || processed === total) {
          lastProgress = processed;
          input.notify?.(`OpenCode import: ${processed}/${total} units (${promptPreview})`);
        }
      },
    });
    log("OpenCode history import report", summarizeHistoryImportReport(report));
    return formatHistoryImportReport(
      "opencode",
      report,
      ref ? `${ref.providerID}/${ref.modelID}` : undefined
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("OpenCode history import failed", { error: message }, "error");
    return `${name} failed: ${message}`;
  } finally {
    endManualImport();
    importCommandRunning = false;
  }
}
