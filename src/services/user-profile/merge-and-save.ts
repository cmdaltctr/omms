import { log } from "../logger.js";
import type { UserProfile, UserProfileData } from "./types.js";

/** Learning makes this many save attempts before it leaves the prompts for a later run. */
export const MAX_PROFILE_SAVE_ATTEMPTS = 3;

/** The profile store operations that a save needs. */
export interface ProfileSaveStore {
  getProfileById(id: string): Promise<UserProfile | null>;
  mergeProfileData(
    existing: UserProfileData,
    updates: Partial<UserProfileData>,
    embedService?: undefined,
    profileId?: string
  ): Promise<UserProfileData>;
  updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string,
    expectedVersion: number,
    learnedPromptIds?: string[]
  ): Promise<boolean>;
}

type ReadProfile = Pick<UserProfile, "id" | "version">;

/**
 * Saves `data` over the profile as the caller read it. Returns false, and changes nothing,
 * when another save landed since. The log holds a code only, never profile content.
 */
export async function saveProfile(
  profile: ReadProfile,
  data: UserProfileData,
  summary: string,
  promptsAnalyzed = 0,
  store?: Pick<ProfileSaveStore, "updateProfile">
): Promise<boolean> {
  const target = store ?? (await import("./user-profile-manager.js")).userProfileManager;
  const saved = await target.updateProfile(
    profile.id,
    data,
    promptsAnalyzed,
    summary,
    profile.version
  );
  if (!saved) log("profile save skipped", { code: "version-changed" }, "warn");
  return saved;
}

/** Optional steps that `saveMergedProfile` applies on every attempt. */
export interface MergeSaveHooks {
  /**
   * Runs on the fresh profile that a retry reads, before the merge (decay, when the setting
   * is on). The first attempt saves `analysis.merged`, which the caller built from its own read.
   */
  beforeMerge?(current: UserProfileData): UserProfileData;
  /**
   * Runs on each merged result before its save (the check of older items). Text it returns
   * is added to the history text after "; ".
   */
  beforeSave?(merged: UserProfileData, profileId: string): Promise<string | null>;
}

/**
 * Saves the merged result of a profile analysis. When another save landed first, it loads
 * the newer profile, merges the same model result into it, and saves again. It never calls
 * the model. Returns false when there is nothing to save or every attempt met a newer version.
 */
export async function saveMergedProfile(
  store: ProfileSaveStore,
  profile: ReadProfile,
  analysis: { raw: Partial<UserProfileData>; merged: UserProfileData | null },
  promptsAnalyzed: number,
  summary: string,
  hooks: MergeSaveHooks = {},
  /** Prompt ids the analysis took in; the landing save records them (see learned-prompts.ts). */
  learnedPromptIds: string[] = []
): Promise<boolean> {
  let merged = analysis.merged;
  let version = profile.version;
  for (let attempt = 1; merged && attempt <= MAX_PROFILE_SAVE_ATTEMPTS; attempt++) {
    const extra = hooks.beforeSave ? await hooks.beforeSave(merged, profile.id) : null;
    const text = extra ? `${summary}; ${extra}` : summary;
    if (
      await store.updateProfile(
        profile.id,
        merged,
        promptsAnalyzed,
        text,
        version,
        learnedPromptIds
      )
    ) {
      return true;
    }
    log("profile save conflict", { attempt, of: MAX_PROFILE_SAVE_ATTEMPTS });
    if (attempt === MAX_PROFILE_SAVE_ATTEMPTS) break;
    const fresh = await store.getProfileById(profile.id);
    if (!fresh) return false;
    const read = JSON.parse(fresh.profileData) as UserProfileData;
    const current = hooks.beforeMerge ? hooks.beforeMerge(read) : read;
    merged = await store.mergeProfileData(current, analysis.raw, undefined, fresh.id);
    version = fresh.version;
  }
  return false;
}
