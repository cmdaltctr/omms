import { z } from "zod";
import { createUserProfileAnalysisSchema, extractJsonObject } from "./extraction.js";
import { log } from "../services/logger.js";
import type { UserProfileData } from "../services/user-profile/types.js";

export interface ModelPort {
  provider: string;
  modelId: string;
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface ExistingProfileInput {
  id: string;
  profileData: string;
}

export interface ProfileAnalysisResult {
  raw: UserProfileData;
  merged: UserProfileData | null;
}

function buildProfileAnalysisSystemPrompt(existingProfile: boolean): string {
  return `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfile ? "update" : "create"} a comprehensive user profile.

CRITICAL: Detect the language used by the user in their prompts. You MUST output all descriptions, categories, and text in the SAME language as the user's prompts.

CRITICAL: All JSON string values MUST escape double quotes with backslash. Do NOT use unescaped quotation marks inside string values.

Respond with a single JSON object matching the update_user_profile contract.`;
}

/** Analyse prompts with a host-neutral model and merge the validated profile. */
export async function analyzeProfile(
  model: ModelPort,
  context: string,
  existingProfile: ExistingProfileInput | null,
  timeoutMs = 120000
): Promise<ProfileAnalysisResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      model.complete(buildProfileAnalysisSystemPrompt(Boolean(existingProfile)), context),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("pi profile analysis: timeout")), timeoutMs);
        timeoutId?.unref?.();
      }),
    ]);
    const schema = createUserProfileAnalysisSchema(z);
    const parsed = schema.safeParse(extractJsonObject(reply));
    if (!parsed.success) {
      log("pi profile analysis: model reply failed shared schema validation", {
        provider: model.provider,
        modelId: model.modelId,
      });
      throw new Error("pi profile analysis: invalid profile payload");
    }
    const raw = parsed.data as UserProfileData;
    if (!existingProfile) return { raw, merged: null };
    const { userProfileManager } = await import("../services/user-profile/user-profile-manager.js");
    const existingData: UserProfileData = JSON.parse(existingProfile.profileData);
    const merged = await userProfileManager.mergeProfileData(
      existingData,
      raw,
      undefined,
      existingProfile.id
    );
    return { raw, merged };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
