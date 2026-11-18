import { CONFIG, refreshConfigIfChanged } from "../../config.js";
import {
  analyzeProfile,
  type ExistingProfileInput,
  type ProfileAnalysisResult,
  type ModelPort,
} from "../../core/profile-analysis.js";
import {
  runProfileLearningPass,
  type ProfileLearningPassResult,
} from "../../core/profile-learning/pass.js";
import type { PiModelHandle } from "./provider.js";

export type { ExistingProfileInput, ProfileAnalysisResult } from "../../core/profile-analysis.js";

export interface PiProfileAnalyzer {
  analyzeProfile(
    context: string,
    existingProfile: ExistingProfileInput | null
  ): Promise<ProfileAnalysisResult | null>;
}

function replyText(reply: { content: Array<{ type: string; text?: string }> }): string {
  return reply.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function adaptPiProfileModel(model: PiModelHandle): ModelPort {
  return {
    provider: model.provider,
    modelId: model.modelId,
    async complete(systemPrompt, userPrompt) {
      const reply = await model.complete({
        systemPrompt,
        messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
      });
      if (reply.stopReason === "error") {
        throw new Error(
          `pi profile analysis: model call failed: ${reply.errorMessage || "unknown error"}`
        );
      }
      return replyText(reply);
    },
  };
}

/** Adapt Pi's model registry to the shared profile analyser. */
export function createPiProfileAnalyzer(
  resolveModel: () => PiModelHandle | null,
  timeoutMs = 120000
): PiProfileAnalyzer {
  return {
    async analyzeProfile(context, existingProfile) {
      const model = resolveModel();
      if (!model) return null;
      return analyzeProfile(adaptPiProfileModel(model), context, existingProfile, timeoutMs);
    },
  };
}

export interface PiProfileLearningInput {
  directory: string;
  /** Pi's live profile model, with the external API behind it (`createPiLiveModels`). */
  model: () => ModelPort | null;
  /** The model of the automatic cleanup. Pi hands over its own profile model. */
  cleanupModel?: () => ModelPort | null;
  notify?: (notification: {
    title: string;
    message: string;
    variant: "success" | "warning" | "error";
  }) => Promise<void> | void;
}

/**
 * Pi's trigger for the shared live learning pass (change unify-profile-learning, design D1).
 * The pass reads Pi's recorded prompts from the prompt store, learns, saves and sends the
 * success notice. Pi adds its failure notice here, when `showErrorToasts` is on. A failure
 * never disables memory operations.
 */
export async function learnPiProfile(
  input: PiProfileLearningInput
): Promise<ProfileLearningPassResult> {
  refreshConfigIfChanged(input.directory);
  const result = await runProfileLearningPass({
    host: "pi",
    directory: input.directory,
    config: CONFIG,
    model: input.model,
    notify: input.notify,
    cleanupModel: input.cleanupModel ?? input.model,
  });
  if (result.outcome === "failed" && CONFIG.showErrorToasts && input.notify) {
    await Promise.resolve(
      input.notify({
        title: "Profile Learning Failed",
        // The reason code only: the provider's message may quote the prompts.
        message: result.reason ?? "error",
        variant: "error",
      })
    ).catch(() => {});
  }
  return result;
}
