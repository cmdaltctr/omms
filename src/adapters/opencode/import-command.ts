import { CONFIG, isConfigured } from "../../config.js";
import { buildBoundedSummaryPrompt } from "../../core/capture-context.js";
import type { CaptureSummaryProvider } from "../../core/host.js";
import type { ModelPort } from "../../core/profile-analysis.js";
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
  type HistoryImportModels,
} from "../../importer/run-import.js";
import { loadOpencodeProvider } from "../../services/ai/opencode-provider-loader.js";
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

export interface OpencodeModelRef {
  providerID: string;
  modelID: string;
}

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

/** Capture and profile calls routed through OpenCode's structured-output sessions. */
export async function createOpencodeImportModels(
  ref: OpencodeModelRef,
  directory: string
): Promise<Required<HistoryImportModels>> {
  const { getV2Client, generateStructuredOutput } = await loadOpencodeProvider();
  const client = getV2Client();
  if (!client) throw new Error("the OpenCode client is not ready; retry in a moment");
  const { z } = await import("zod");
  const { buildCaptureSystemPrompt, createUserProfileAnalysisSchema, parseCaptureSummary } =
    await import("../../core/extraction.js");
  const { detectLanguage, getLanguageName } = await import("../../services/language-detector.js");

  const captureSchema = z.object({
    summary: z.string().optional(),
    type: z.string(),
    tags: z.array(z.string()).optional(),
  });
  const capture: CaptureSummaryProvider = {
    async summarize(request) {
      const target =
        CONFIG.autoCaptureLanguage && CONFIG.autoCaptureLanguage !== "auto"
          ? CONFIG.autoCaptureLanguage
          : detectLanguage(request.userPrompt);
      const systemPrompt = buildCaptureSystemPrompt(getLanguageName(target));
      const result = await generateStructuredOutput({
        client,
        ...ref,
        systemPrompt,
        userPrompt: buildBoundedSummaryPrompt(
          request.context,
          systemPrompt,
          z.toJSONSchema(captureSchema)
        ),
        schema: captureSchema,
        directory,
      });
      const parsed = parseCaptureSummary(JSON.stringify(result));
      if (!parsed) throw new Error("History capture returned an invalid summary");
      return parsed;
    },
  };
  const profileSchema = createUserProfileAnalysisSchema(z);
  const profile: ModelPort = {
    provider: ref.providerID,
    modelId: ref.modelID,
    async complete(systemPrompt, userPrompt) {
      const result = await generateStructuredOutput({
        client,
        ...ref,
        systemPrompt,
        userPrompt,
        schema: profileSchema,
        directory,
      });
      return JSON.stringify(result);
    },
  };
  return { capture, profile };
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
    const models =
      ref && !parsed.dryRun ? await createOpencodeImportModels(ref, input.directory) : {};
    if (!parsed.dryRun) {
      try {
        await memoryClient.warmup();
      } catch (error) {
        log("OpenCode import: memory warmup failed", { error: String(error) });
      }
    }

    let lastProgress = 0;
    const report = await runHistoryImport("opencode", parsed, {
      cwd: input.directory,
      models,
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
    log("OpenCode history import failed", { error: message });
    return `${name} failed: ${message}`;
  } finally {
    importCommandRunning = false;
  }
}

/** The model of the session's latest user message, from the V1 message list. */
export async function latestUserMessageModel(
  client: { session: { messages: (input: { path: { id: string } }) => Promise<{ data?: any }> } },
  sessionID: string
): Promise<OpencodeModelRef | null> {
  try {
    const messages: any[] = (await client.session.messages({ path: { id: sessionID } })).data ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const model = messages[i]?.info?.role === "user" ? messages[i].info.model : undefined;
      if (model?.providerID && model?.modelID) {
        return { providerID: model.providerID, modelID: model.modelID };
      }
    }
  } catch (error) {
    log("OpenCode import: could not read the session model", { error: String(error) });
  }
  return null;
}
