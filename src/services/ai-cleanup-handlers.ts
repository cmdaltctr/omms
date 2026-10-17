import { log } from "./logger.js";
import { sortProfileItems, stripProfileVectors } from "../utils/profile.js";
import type { UserProfileData } from "./user-profile/types.js";
import type { UserProfileManager } from "./user-profile/user-profile-manager.js";
import type { AiCleanupJobDeps, AiCleanupJobView } from "./user-profile/ai-cleanup-job.js";

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AiCleanupHandlerDeps extends AiCleanupJobDeps {
  manager?: UserProfileManager;
}

async function cleanupUser(userId?: string): Promise<string> {
  if (userId) return userId;
  const { CONFIG } = await import("../config.js");
  const { resolveWebProfileUserId } = await import("./profile-identity.js");
  return (await resolveWebProfileUserId(CONFIG)) || "unknown";
}

async function managerOf(deps: AiCleanupHandlerDeps): Promise<UserProfileManager> {
  return (
    deps.manager ?? (await import("./user-profile/user-profile-manager.js")).userProfileManager
  );
}

function handlerError(step: string, error: unknown): ApiResponse<never> {
  // The log never holds profile text, so only the error's kind is kept.
  log(`AI cleanup ${step}: error`, { code: error instanceof Error ? error.name : "unknown" });
  return { success: false, error: String(error) };
}

/** The profile in the order the dialog lists it, so item ids match its positions. */
function sortedProfile(profileData: string): UserProfileData {
  const data: UserProfileData = JSON.parse(profileData);
  data.preferences = sortProfileItems(data.preferences, "confidence");
  data.patterns = sortProfileItems(data.patterns, "frequency");
  data.workflows = sortProfileItems(data.workflows, "frequency");
  return data;
}

/** The job as the dialog sees it: no vectors, and no API key in an error. */
async function clientView(job: AiCleanupJobView | null): Promise<AiCleanupJobView | null> {
  if (job?.status.state === "done") {
    const result = { ...job.status.result, old: stripProfileVectors(job.status.result.old) };
    return { ...job, status: { ...job.status, result } };
  }
  if (job?.status.state === "failed") {
    const { CONFIG } = await import("../config.js");
    const { redactTraceText } = await import("./capture-diagnostics.js");
    return { ...job, status: { ...job.status, error: redactTraceText(job.status.error, CONFIG) } };
  }
  return job;
}

/**
 * Starts a background cleanup of the selected items, or returns the job already running.
 * A stale `profileVersion` fails at once, because the dialog's item ids are positions in
 * the profile it read.
 */
export async function handleAiCleanupStart(
  userId?: string,
  body?: any,
  deps: AiCleanupHandlerDeps = {}
): Promise<ApiResponse<AiCleanupJobView | null>> {
  try {
    const { getAiCleanupJob, startAiCleanupJob } = await import("./user-profile/ai-cleanup-job.js");
    const user = await cleanupUser(userId);
    const current = getAiCleanupJob(user);
    if (current?.status.state === "running") return { success: true, data: current };

    const profile = await (await managerOf(deps)).getActiveProfile(user);
    if (!profile) return { success: false, error: "No profile found to clean up" };
    if (typeof body?.profileVersion === "number" && profile.version !== body.profileVersion) {
      return { success: false, error: "Profile changed. Reload it before running AI cleanup." };
    }
    const includeIds = Array.isArray(body?.includeIds)
      ? body.includeIds.filter((id: unknown): id is string => typeof id === "string")
      : undefined;
    const job = startAiCleanupJob(
      user,
      { profileData: sortedProfile(profile.profileData), includeIds },
      deps
    );
    return { success: true, data: await clientView(job) };
  } catch (error) {
    return handlerError("start", error);
  }
}

/** The state of the user's job, or null when there is none. */
export async function handleAiCleanupStatus(
  userId?: string
): Promise<ApiResponse<AiCleanupJobView | null>> {
  try {
    const { getAiCleanupJob } = await import("./user-profile/ai-cleanup-job.js");
    return { success: true, data: await clientView(getAiCleanupJob(await cleanupUser(userId))) };
  } catch (error) {
    return handlerError("status", error);
  }
}

/** Stops a running job, or discards a finished one. */
export async function handleAiCleanupStop(userId?: string): Promise<ApiResponse<null>> {
  try {
    const { stopAiCleanupJob } = await import("./user-profile/ai-cleanup-job.js");
    stopAiCleanupJob(await cleanupUser(userId));
    return { success: true, data: null };
  } catch (error) {
    return handlerError("stop", error);
  }
}

/**
 * Puts the ticked changes of the finished job into the newest profile and saves it with
 * the version check. When another save lands first, it loads the profile and tries
 * again, at most MAX_PROFILE_SAVE_ATTEMPTS times. The request's `profile` field is
 * ignored; the job holds the result.
 */
export async function handleAiCleanupApply(
  userId?: string,
  body?: any,
  deps: AiCleanupHandlerDeps = {}
): Promise<ApiResponse<{ applied: number; skipped: number }>> {
  try {
    const { getAiCleanupResult, stopAiCleanupJob } =
      await import("./user-profile/ai-cleanup-job.js");
    const { applyCleanupEdits } = await import("./user-profile/ai-cleanup-apply.js");
    const { MAX_PROFILE_SAVE_ATTEMPTS, saveProfile } =
      await import("./user-profile/merge-and-save.js");
    const user = await cleanupUser(userId);
    const job = getAiCleanupResult(user);
    if (!job) return { success: false, error: "No finished cleanup found. Run AI cleanup again." };

    const accepted = {
      merged: Array.isArray(body?.acceptedMerged) ? body.acceptedMerged : [],
      removed: Array.isArray(body?.acceptedRemoved) ? body.acceptedRemoved : [],
    };
    const manager = await managerOf(deps);
    for (let attempt = 1; attempt <= MAX_PROFILE_SAVE_ATTEMPTS; attempt++) {
      const profile = await manager.getActiveProfile(user);
      if (!profile) return { success: false, error: "Profile not found" };
      const result = applyCleanupEdits(JSON.parse(profile.profileData), job, accepted);
      const saved =
        result.applied === 0 ||
        (await saveProfile(profile, result.profile, "AI cleanup applied", 0, manager));
      if (saved) {
        stopAiCleanupJob(user);
        return { success: true, data: { applied: result.applied, skipped: result.skipped } };
      }
      log("AI cleanup apply: save conflict", { attempt, of: MAX_PROFILE_SAVE_ATTEMPTS });
    }
    return { success: false, error: "Profile saved at the same moment. Try Apply again." };
  } catch (error) {
    return handlerError("apply", error);
  }
}
