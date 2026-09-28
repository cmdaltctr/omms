import { CONFIG } from "../../config.js";
import { parseBackfillModel } from "../../importer/backfill-model.js";
import { resolveExternalBackfillModels } from "../../importer/external-backfill-models.js";
import type { HistoryImportModels } from "../../importer/run-import.js";
import { createPiLiveModels } from "./live-model.js";
import { adaptPiProfileModel } from "./profile.js";
import { createPiCaptureProvider, resolveImportModel, type PiModelContext } from "./provider.js";

/** Resolve the Pi backfill independently of the manual import's session-model rule. */
export async function resolvePiBackfillModels(
  ctx: PiModelContext,
  config: {
    piBackfillModel?: string;
    memoryProvider?: string;
    memoryModel?: string;
    memoryApiUrl?: string;
    memoryApiKey?: string;
  } = CONFIG
): Promise<{ model: string; models: HistoryImportModels }> {
  const choice = parseBackfillModel(config, "pi");
  if (choice === "external") return resolveExternalBackfillModels("pi", config);
  if (choice === "inherit") {
    const live = createPiLiveModels(ctx);
    const profile = live.profile();
    if (!profile) throw new Error("Pi backfill: no live-capture model is available");
    const model = profile.modelId || CONFIG.memoryModel;
    return {
      model: `${profile.provider}/${model ?? "unknown"}`,
      models: { capture: live.capture, profile },
    };
  }
  const selected = resolveImportModel(ctx, `${choice.provider}/${choice.model}`);
  if (!selected) throw new Error(`Pi backfill model not found: ${choice.provider}/${choice.model}`);
  return {
    model: `${selected.provider}/${selected.modelId}`,
    models: {
      capture: createPiCaptureProvider(() => selected),
      profile: adaptPiProfileModel(selected),
    },
  };
}
