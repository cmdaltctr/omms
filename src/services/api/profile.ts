import { log } from "../logger.js";
import type { UserProfileData } from "../user-profile/types.js";
import { saveProfile } from "../user-profile/merge-and-save.js";
import { sortProfileItems, stripProfileVectors } from "../../utils/profile.js";
import { resolveWebProfileUserId } from "../profile-identity.js";
import { safeToISOString, type ApiConfig, type ApiResponse } from "./shared.js";

export async function handleGetUserProfile(
  config: ApiConfig,
  userId?: string
): Promise<ApiResponse<any>> {
  try {
    const { userProfileManager } = await import("../user-profile/user-profile-manager.js");
    let targetUserId = userId;
    if (!targetUserId) {
      targetUserId = (await resolveWebProfileUserId(config.CONFIG)) || "unknown";
    }
    const profile = await userProfileManager.getActiveProfile(targetUserId);
    if (!profile)
      return {
        success: true,
        data: {
          exists: false,
          userId: targetUserId,
          message: "No profile found. Keep chatting to build your profile.",
        },
      };
    const profileData = JSON.parse(profile.profileData);
    profileData.preferences = sortProfileItems(profileData.preferences as any[], "confidence");
    profileData.patterns = sortProfileItems(profileData.patterns as any[], "frequency");
    profileData.workflows = sortProfileItems(profileData.workflows as any[], "frequency");
    return {
      success: true,
      data: {
        exists: true,
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        userName: profile.userName,
        userEmail: profile.userEmail,
        version: profile.version,
        createdAt: safeToISOString(profile.createdAt),
        lastAnalyzedAt: safeToISOString(profile.lastAnalyzedAt),
        totalPromptsAnalyzed: profile.totalPromptsAnalyzed,
        profileData: stripProfileVectors(profileData),
      },
    };
  } catch (error) {
    log("handleGetUserProfile: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleGetProfileChangelog(
  profileId: string,
  limit: number = 5
): Promise<ApiResponse<any[]>> {
  try {
    if (!profileId) return { success: false, error: "profileId is required" };
    const { userProfileManager } = await import("../user-profile/user-profile-manager.js");
    const changelogs = await userProfileManager.getProfileChangelogs(profileId, limit);
    const formattedChangelogs = changelogs.map((c) => ({
      id: c.id,
      profileId: c.profileId,
      version: c.version,
      changeType: c.changeType,
      changeSummary: c.changeSummary,
      createdAt: safeToISOString(c.createdAt),
    }));
    return { success: true, data: formattedChangelogs };
  } catch (error) {
    log("handleGetProfileChangelog: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleGetProfileSnapshot(changelogId: string): Promise<ApiResponse<any>> {
  try {
    if (!changelogId) return { success: false, error: "changelogId is required" };
    const { userProfileManager } = await import("../user-profile/user-profile-manager.js");
    const changelog = await userProfileManager.getChangelogById(changelogId);
    if (!changelog) return { success: false, error: "Changelog not found" };
    const profileData = stripProfileVectors(JSON.parse(changelog.profileDataSnapshot));
    return {
      success: true,
      data: {
        version: changelog.version,
        createdAt: safeToISOString(changelog.createdAt),
        profileData,
      },
    };
  } catch (error) {
    log("handleGetProfileSnapshot: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleRefreshProfile(
  config: ApiConfig,
  userId?: string
): Promise<ApiResponse<any>> {
  try {
    const { userProfileManager } = await import("../user-profile/user-profile-manager.js");
    const { userPromptManager } = await import("../user-prompt/user-prompt-manager.js");
    let targetUserId = userId;
    if (!targetUserId) {
      targetUserId = (await resolveWebProfileUserId(config.CONFIG)) || "unknown";
    }
    const profile = await userProfileManager.getActiveProfile(targetUserId);
    let decayApplied = false;
    if (profile) {
      const pData = JSON.parse(profile.profileData);
      const { data: decayed, hasChanges } = userProfileManager.decayInMemory(pData);
      if (hasChanges) {
        decayApplied = await saveProfile(profile, decayed, "Applied confidence decay");
      }
    }
    const unanalyzedCount = await userPromptManager.countUnanalyzedForUserLearning();
    return {
      success: true,
      data: {
        message: decayApplied ? "Profile confidence decay applied" : "Profile refresh queued",
        profileExists: Boolean(profile),
        decayApplied,
        unanalyzedPrompts: unanalyzedCount,
        note: "Confidence decay runs immediately; AI profile learning still runs when the prompt threshold is reached",
      },
    };
  } catch (error) {
    log("handleRefreshProfile: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleUpdateProfileItem(
  config: ApiConfig,
  body?: any
): Promise<ApiResponse<any>> {
  try {
    const { userProfileManager } = await import("../user-profile/user-profile-manager.js");

    const userId = (await resolveWebProfileUserId(config.CONFIG)) || "unknown";
    if (!userId) return { success: false, error: "Unable to resolve user identity" };

    const profile = await userProfileManager.getActiveProfile(userId);
    if (!profile) return { success: false, error: "No profile found" };

    const { type, index, action, category, description, steps } = body || {};
    if (!type || index === undefined || !action) {
      return { success: false, error: "type, index, and action are required" };
    }
    if (!["preferences", "patterns", "workflows"].includes(type)) {
      return { success: false, error: "type must be preferences, patterns, or workflows" };
    }
    if (!["edit", "delete"].includes(action)) {
      return { success: false, error: "action must be edit or delete" };
    }

    const profileData: UserProfileData = JSON.parse(profile.profileData);
    const items: any[] = (profileData as any)[type] || [];
    // Re-sort to match handleGetUserProfile's display order
    const metric = type === "preferences" ? "confidence" : "frequency";
    const sorted = sortProfileItems(items as any[], metric);

    if (index < 0 || index >= sorted.length) {
      return { success: false, error: "index out of range" };
    }

    if (action === "delete") {
      sorted.splice(index, 1);
    } else {
      const item = sorted[index];
      if (!item) return { success: false, error: "Item not found" };
      if (category !== undefined && type !== "workflows") item.category = category;
      if (description !== undefined && description !== item.description) {
        item.description = description;
        item.centroid = undefined;
        item.anchor = undefined;
      }
      if (steps !== undefined && Array.isArray(steps) && type === "workflows") item.steps = steps;
    }

    (profileData as any)[type] = sorted;

    const changeSummary =
      action === "delete"
        ? `Deleted ${type.slice(0, -1)} at index ${index}`
        : `Edited ${type.slice(0, -1)} at index ${index}`;

    const success = await saveProfile(profile, profileData, changeSummary);
    if (!success)
      return { success: false, error: "Profile was modified by another session. Please retry." };

    return {
      success: true,
      data: { message: `${action} successful`, version: profile.version + 1 },
    };
  } catch (error) {
    log("handleUpdateProfileItem: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
