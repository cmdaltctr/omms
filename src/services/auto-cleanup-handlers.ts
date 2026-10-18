import { log } from "./logger.js";
import type { UserProfileManager } from "./user-profile/user-profile-manager.js";
import type { AutoCleanupSummary } from "./user-profile/auto-cleanup-store.js";

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AutoCleanupHandlerDeps {
  manager?: Pick<UserProfileManager, "getActiveProfile" | "updateProfile">;
}

async function cleanupUser(userId?: string): Promise<string> {
  if (userId) return userId;
  const { CONFIG } = await import("../config.js");
  const { resolveWebProfileUserId } = await import("./profile-identity.js");
  return (await resolveWebProfileUserId(CONFIG)) || "unknown";
}

async function managerOf(deps: AutoCleanupHandlerDeps) {
  return (
    deps.manager ?? (await import("./user-profile/user-profile-manager.js")).userProfileManager
  );
}

function handlerError(step: string, error: unknown): ApiResponse<never> {
  // The log never holds profile text, so only the error's kind is kept.
  log(
    `Automatic cleanup ${step}: error`,
    {
      code: error instanceof Error ? error.name : "unknown",
    },
    "error"
  );
  return { success: false, error: String(error) };
}

/** The newest automatic cleanup that can still be undone, without its items. */
export async function handleAutoCleanupStatus(
  userId?: string,
  deps: AutoCleanupHandlerDeps = {}
): Promise<ApiResponse<AutoCleanupSummary | null>> {
  try {
    const { latestOpenAutoCleanupSummary } = await import("./user-profile/auto-cleanup-store.js");
    const profile = await (await managerOf(deps)).getActiveProfile(await cleanupUser(userId));
    if (!profile) return { success: true, data: null };
    return { success: true, data: await latestOpenAutoCleanupSummary(profile.id) };
  } catch (error) {
    return handlerError("status", error);
  }
}

/**
 * Undoes the newest automatic cleanup that is not undone, in the newest profile, with the
 * version check. A save conflict is tried again at most three times; after that the profile
 * and the record stay as they were.
 */
export async function handleAutoCleanupUndo(
  userId?: string,
  deps: AutoCleanupHandlerDeps = {}
): Promise<ApiResponse<{ restored: number; notFound: number }>> {
  try {
    const { latestOpenAutoCleanup, markAutoCleanupUndone } =
      await import("./user-profile/auto-cleanup-store.js");
    const { undoCleanupEdits } = await import("./user-profile/ai-cleanup-undo.js");
    const { applyToNewestProfile } = await import("./user-profile/profile-edit-save.js");
    const user = await cleanupUser(userId);
    const manager = await managerOf(deps);
    const profile = await manager.getActiveProfile(user);
    const record = profile ? await latestOpenAutoCleanup(profile.id) : null;
    if (!record) return { success: false, error: "Nothing to undo." };

    const outcome = await applyToNewestProfile(
      user,
      (data) => {
        const undone = undoCleanupEdits(data, record.entries);
        return {
          profile: undone.profile,
          changed: undone.restored > 0,
          result: { restored: undone.restored, notFound: undone.notFound },
        };
      },
      { summary: "Automatic cleanup undone", store: manager as never }
    );
    if (outcome.status === "no-profile") return { success: false, error: "Nothing to undo." };
    if (outcome.status === "conflict") {
      return { success: false, error: "Profile saved at the same moment. Try Undo again." };
    }
    await markAutoCleanupUndone(record.id);
    log("Automatic cleanup undone", {
      restored: outcome.result.restored,
      notFound: outcome.result.notFound,
    });
    return { success: true, data: outcome.result };
  } catch (error) {
    return handlerError("undo", error);
  }
}
