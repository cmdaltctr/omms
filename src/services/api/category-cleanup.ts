import { log } from "../logger.js";
import { resolveWebProfileUserId } from "../profile-identity.js";
import type { ApiConfig, ApiResponse } from "./shared.js";

type CategoryCleanupDeps = import("../user-profile/category-cleanup.js").CleanupDeps;

async function categoryCleanupUser(config: ApiConfig, userId?: string): Promise<string> {
  return userId || (await resolveWebProfileUserId(config.CONFIG)) || "unknown";
}

function categoryCleanupError(step: string, error: unknown): ApiResponse<never> {
  // The log never holds category names or descriptions, so only the error's kind is kept.
  log(
    `category cleanup ${step}: error`,
    { code: error instanceof Error ? error.name : "unknown" },
    "error"
  );
  return { success: false, error: String(error) };
}

/** Starts a background preview job, or returns the one already running. Changes nothing in the profile. */
export async function handleCategoryCleanupStart(
  config: ApiConfig,
  userId?: string,
  deps?: CategoryCleanupDeps
): Promise<ApiResponse<any>> {
  try {
    const { startCategoryCleanupJob } = await import("../user-profile/category-cleanup-job.js");
    return {
      success: true,
      data: startCategoryCleanupJob(await categoryCleanupUser(config, userId), deps),
    };
  } catch (error) {
    return categoryCleanupError("start", error);
  }
}

/** The state of the user's preview job, or null when none was started in this process. */
export async function handleCategoryCleanupStatus(
  config: ApiConfig,
  userId?: string
): Promise<ApiResponse<any>> {
  try {
    const { getCategoryCleanupJob } = await import("../user-profile/category-cleanup-job.js");
    return {
      success: true,
      data: getCategoryCleanupJob(await categoryCleanupUser(config, userId)),
    };
  } catch (error) {
    return categoryCleanupError("status", error);
  }
}

export async function handleCategoryCleanupApply(
  config: ApiConfig,
  userId?: string,
  body?: any,
  deps?: CategoryCleanupDeps
): Promise<ApiResponse<any>> {
  try {
    const { applyCategoryCleanup } = await import("../user-profile/category-cleanup.js");
    const { clearCategoryCleanupJob } = await import("../user-profile/category-cleanup-job.js");
    const user = await categoryCleanupUser(config, userId);
    const result = await applyCategoryCleanup(user, { groups: body?.groups }, deps);
    if (result.ok) {
      // The finished preview no longer matches the profile.
      clearCategoryCleanupJob(user);
      return { success: true, data: { renamed: result.renamed } };
    }
    const messages = {
      stale: "Profile saved at the same moment. Try Apply again.",
      no_profile: "No profile found to clean up",
      invalid: "Each group needs at least two labels and a name.",
    };
    return { success: false, error: messages[result.error] };
  } catch (error) {
    return categoryCleanupError("apply", error);
  }
}

export async function handleCategoryCleanupUndo(
  config: ApiConfig,
  userId?: string,
  deps?: CategoryCleanupDeps
): Promise<ApiResponse<any>> {
  try {
    const { undoCategoryCleanup } = await import("../user-profile/category-cleanup.js");
    const { clearCategoryCleanupJob } = await import("../user-profile/category-cleanup-job.js");
    const user = await categoryCleanupUser(config, userId);
    const result = await undoCategoryCleanup(user, deps);
    if (result.ok) {
      clearCategoryCleanupJob(user);
      return { success: true, data: { restored: result.restored, notFound: result.notFound } };
    }
    return {
      success: false,
      error: result.error === "stale" ? "Profile changed. Try the undo again." : "Nothing to undo.",
    };
  } catch (error) {
    return categoryCleanupError("undo", error);
  }
}
