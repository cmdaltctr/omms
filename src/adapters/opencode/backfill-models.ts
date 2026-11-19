import { CONFIG } from "../../config.js";
import { parseBackfillModel } from "../../utils/backfill-model.js";
import { resolveExternalBackfillModels } from "../../importer/external-backfill-models.js";
import { selectImportModel } from "../../importer/model-selection.js";
import type { HistoryImportModels } from "../../importer/run-import.js";
import { getAutoCaptureProviderStatus } from "../../services/ai/live-model-choice.js";
import { createOpencodeImportModels, type OpencodeModelRef } from "./opencode-import-models.js";

interface BackfillConfig {
  opencodeBackfillModel?: string;
  opencodeProvider?: string;
  opencodeModel?: string;
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
}

export interface OpenCodeBackfillContext {
  /** True when OpenCode lists the provider; reads the list again when the provider is missing. */
  confirmProviderConnected: (providerID: string) => Promise<boolean>;
  directory: string;
  configModel: () => Promise<string | null>;
  makeModels?: typeof createOpencodeImportModels;
  externalModels?: typeof selectImportModel;
}

/** Apply the live-model rule when inherit is selected; named models need sign-in. */
export async function resolveOpencodeBackfillModels(
  config: BackfillConfig = CONFIG,
  context: OpenCodeBackfillContext
): Promise<{ model: string; models: HistoryImportModels }> {
  const choice = parseBackfillModel(config, "opencode");
  if (choice === "external") {
    return resolveExternalBackfillModels("opencode", config, context.externalModels);
  }
  let ref: OpencodeModelRef;
  if (choice === "inherit") {
    const live = getAutoCaptureProviderStatus(config);
    if (!live.ready) throw new Error(`OpenCode backfill: ${live.issues.join("; ")}`);
    if (live.mode === "manual") {
      const external = (context.externalModels ?? selectImportModel)({});
      return {
        model: `${external.provider}/${external.modelId}`,
        models: { capture: external.capture, profile: external.profile },
      };
    }
    const selected =
      live.mode === "opencode"
        ? `${config.opencodeProvider}/${config.opencodeModel}`
        : await context.configModel();
    if (!selected) throw new Error("OpenCode backfill: no configured default model");
    const parsed = parseBackfillModel({ opencodeBackfillModel: selected }, "opencode");
    if (typeof parsed === "string")
      throw new Error("OpenCode backfill: no configured default model");
    ref = { providerID: parsed.provider, modelID: parsed.model };
  } else {
    ref = { providerID: choice.provider, modelID: choice.model };
  }
  if (!(await context.confirmProviderConnected(ref.providerID))) {
    throw new Error(`OpenCode backfill provider ${ref.providerID} is not connected`);
  }
  const models = await (context.makeModels ?? createOpencodeImportModels)(ref);
  return { model: `${ref.providerID}/${ref.modelID}`, models };
}
