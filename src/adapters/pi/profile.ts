import { CONFIG } from "../../config.js";
import {
  analyzeProfile,
  type ExistingProfileInput,
  type ProfileAnalysisResult,
  type ModelPort,
} from "../../core/profile-analysis.js";
import { log } from "../../services/logger.js";
import { getTags } from "../../services/tags.js";
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
  prompts: string[];
  resolveModel: () => PiModelHandle | null;
  notify?: (notification: {
    title: string;
    message: string;
    variant: "success" | "warning" | "error" | "info";
  }) => Promise<void> | void;
}

/**
 * Pi-side profile learning lifecycle: analyse a batch of settled user prompts
 * through the model bridge and persist via the shared profile manager. Failures
 * log (and optionally toast) without ever disabling memory operations. The
 * decay/validation-task machinery of the OpenCode idle path is not ported;
 * this applies the analysed batch directly (documented limitation).
 */
export async function performPiProfileLearning(input: PiProfileLearningInput): Promise<void> {
  if (input.prompts.length === 0) return;

  try {
    const tags = getTags(input.directory);
    if (!tags.user.userEmail) {
      log("pi profile learning: skipped (no user email resolved)", {
        directory: input.directory,
      });
      return;
    }
    const userId = tags.user.userEmail;

    const { userProfileManager } =
      await import("../../services/user-profile/user-profile-manager.js");
    const existing = await userProfileManager.getActiveProfile(userId);

    const analyzer = createPiProfileAnalyzer(input.resolveModel);
    const context = input.prompts.map((prompt, i) => `${i + 1}. ${prompt}`).join("\n");
    const analysis = await analyzer.analyzeProfile(
      context,
      existing ? { id: existing.id, profileData: existing.profileData } : null
    );
    if (!analysis) {
      log("pi profile learning: skipped (no model available)", { userId });
      return;
    }

    if (existing && analysis.merged) {
      const updated = await userProfileManager.updateProfile(
        existing.id,
        analysis.merged,
        input.prompts.length,
        `Pi analysis of ${input.prompts.length} prompts`
      );
      if (!updated) {
        log("pi profile learning: update conflict", { profileId: existing.id });
        return;
      }
    } else {
      await userProfileManager.createProfile(
        userId,
        tags.user.displayName || userId,
        tags.user.userName || userId,
        tags.user.userEmail || userId,
        analysis.raw,
        input.prompts.length
      );
    }

    log("pi profile learning: profile updated", {
      userId,
      prompts: input.prompts.length,
      hadExisting: Boolean(existing),
    });

    if (CONFIG.showUserProfileToasts && input.notify) {
      await Promise.resolve(
        input.notify({
          title: "User Profile Updated",
          message: `Analyzed ${input.prompts.length} prompts and updated your profile`,
          variant: "success",
        })
      ).catch(() => {});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`pi profile learning: aborted (${message})`);
    if (CONFIG.showErrorToasts && input.notify) {
      const shortReason = message.length > 100 ? message.substring(0, 100) + "..." : message;
      await Promise.resolve(
        input.notify({
          title: "Profile Learning Failed",
          message: shortReason,
          variant: "error",
        })
      ).catch(() => {});
    }
  }
}
