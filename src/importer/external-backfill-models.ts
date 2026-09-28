import { externalModelIssues } from "../services/ai/live-model-choice.js";
import type { BackfillHost } from "./backfill-model.js";
import type { SelectedImportModel } from "./model-selection.js";
import type { HistoryImportModels } from "./run-import.js";

interface ExternalConfig {
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
}

/** A backfill set to `external`: the external API, or an error naming the missing settings. */
export async function resolveExternalBackfillModels(
  host: BackfillHost,
  config: ExternalConfig,
  externalModels?: (flags: Record<string, never>) => SelectedImportModel
): Promise<{ model: string; models: HistoryImportModels }> {
  const issues = externalModelIssues(config);
  const label = host === "pi" ? "Pi" : "OpenCode";
  if (issues.length > 0) throw new Error(`${label} backfill: ${issues.join("; ")}`);
  const select = externalModels ?? (await import("./model-selection.js")).selectImportModel;
  const external = select({});
  return {
    model: `${external.provider}/${external.modelId}`,
    models: { capture: external.capture, profile: external.profile },
  };
}
