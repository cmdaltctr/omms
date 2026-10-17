import { log } from "../logger.js";
import { MAX_PROFILE_SAVE_ATTEMPTS, saveProfile } from "./merge-and-save.js";
import type { UserProfile, UserProfileData } from "./types.js";

/** What an edit returns: the profile to save, whether it differs, and a value for the caller. */
export interface ProfileEdit<R> {
  profile: UserProfileData;
  changed: boolean;
  result: R;
}

export type ProfileEditOutcome<R> =
  { status: "saved" | "unchanged"; result: R } | { status: "conflict" } | { status: "no-profile" };

export interface ProfileEditStore {
  getActiveProfile(userId: string): Promise<UserProfile | null>;
  updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string,
    expectedVersion: number
  ): Promise<boolean>;
}

export interface ProfileEditOptions<R> {
  summary: string;
  store?: ProfileEditStore;
  /**
   * Runs before each save attempt, with what the edit returned and the profile it read. The function it returns
   * runs when that attempt does not save, so a record written here can be withdrawn.
   */
  beforeSave?: (result: R, profile: UserProfile) => Promise<(() => Promise<void>) | void>;
}

/**
 * Loads the newest profile, lets `edit` change it, and saves with the version check. When
 * another save lands first, it loads the profile again and edits that one, at most
 * MAX_PROFILE_SAVE_ATTEMPTS times. It never calls a model. The log holds codes only.
 * An error thrown by `edit` reaches the caller.
 */
export async function applyToNewestProfile<R>(
  userId: string,
  edit: (data: UserProfileData, profile: UserProfile) => ProfileEdit<R>,
  options: ProfileEditOptions<R>
): Promise<ProfileEditOutcome<R>> {
  const store = options.store ?? (await import("./user-profile-manager.js")).userProfileManager;
  for (let attempt = 1; attempt <= MAX_PROFILE_SAVE_ATTEMPTS; attempt++) {
    const profile = await store.getActiveProfile(userId);
    if (!profile) return { status: "no-profile" };
    const edited = edit(JSON.parse(profile.profileData) as UserProfileData, profile);
    if (!edited.changed) return { status: "unchanged", result: edited.result };
    const withdraw = await options.beforeSave?.(edited.result, profile);
    if (await saveProfile(profile, edited.profile, options.summary, 0, store)) {
      return { status: "saved", result: edited.result };
    }
    await withdraw?.();
    log("profile edit: save conflict", { attempt, of: MAX_PROFILE_SAVE_ATTEMPTS });
  }
  return { status: "conflict" };
}
