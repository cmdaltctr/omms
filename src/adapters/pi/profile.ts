import { z } from "zod";
import { CONFIG } from "../../config.js";
import { createUserProfileAnalysisSchema, extractJsonObject } from "../../core/extraction.js";
import type { UserProfileData } from "../../services/user-profile/types.js";
import type { PiModelHandle } from "./provider.js";
import { log } from "../../services/logger.js";
import { getTags } from "../../services/tags.js";

/**
 * System prompt mirrored from the OpenCode profile-learning path
 * (src/services/user-memory-learning.ts, analyzeUserProfile). Kept local so
 * the Pi adapter does not import an OpenCode-coupled module; update both when
 * the analysis contract changes.
 */
function buildProfileAnalysisSystemPrompt(existingProfile: boolean): string {
  return `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfile ? "update" : "create"} a comprehensive user profile.

CRITICAL: Detect the language used by the user in their prompts. You MUST output all descriptions, categories, and text in the SAME language as the user's prompts.

CRITICAL: All JSON string values MUST escape double quotes with backslash. Do NOT use unescaped quotation marks inside string values.

Respond with a single JSON object matching the update_user_profile contract.`;
}

export interface ExistingProfileInput {
  id: string;
  profileData: string;
}

export interface ProfileAnalysisResult {
  raw: UserProfileData;
  merged: UserProfileData | null;
}

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

/**
 * Bridge the shared user-profile analysis onto Pi's model runtime. Uses the
 * same schema and system prompt as the OpenCode structured-output path, so
 * analysis results are validated with the shared schema before they reach the
 * profile storage layer. Model failures throw (mirroring provider semantics);
 * a missing model returns null so callers can skip without disabling anything.
 */
export function createPiProfileAnalyzer(
  resolveModel: () => PiModelHandle | null,
  timeoutMs = 120000
): PiProfileAnalyzer {
  return {
    async analyzeProfile(context, existingProfile) {
      const model = resolveModel();
      if (!model) return null;

      // Unref'd and cleared so the losing timeout timer never keeps the host
      // process alive after the race settles.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const reply = await Promise.race([
          model.complete({
            systemPrompt: buildProfileAnalysisSystemPrompt(Boolean(existingProfile)),
            messages: [{ role: "user", content: context, timestamp: Date.now() }],
          }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("pi profile analysis: timeout")),
              timeoutMs
            );
            timeoutId?.unref?.();
          }),
        ]);

        if (reply.stopReason === "error") {
          throw new Error(
            `pi profile analysis: model call failed: ${reply.errorMessage || "unknown error"}`
          );
        }

        const schema = createUserProfileAnalysisSchema(z);
        const parsed = schema.safeParse(extractJsonObject(replyText(reply)));
        if (!parsed.success) {
          log("pi profile analysis: model reply failed shared schema validation", {
            provider: model.provider,
            modelId: model.modelId,
          });
          throw new Error("pi profile analysis: invalid profile payload");
        }

        const rawData = parsed.data as unknown as UserProfileData;

        if (existingProfile) {
          const { userProfileManager } =
            await import("../../services/user-profile/user-profile-manager.js");
          const existingData: UserProfileData = JSON.parse(existingProfile.profileData);
          const merged = await userProfileManager.mergeProfileData(
            existingData,
            rawData,
            undefined,
            existingProfile.id
          );
          return { raw: rawData, merged };
        }

        return { raw: rawData, merged: null };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
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
