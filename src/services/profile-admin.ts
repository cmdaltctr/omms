import type { UserProfile, UserProfileData } from "./user-profile/types.js";

/** The profile store operations the Profiles card needs. */
export interface ProfileAdminStore {
  getAllActiveProfiles(): Promise<UserProfile[]>;
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
    changeSummary: string
  ): Promise<boolean>;
  deactivateProfile(profileId: string): Promise<boolean>;
}

export interface ProfileSummary {
  id: string;
  userId: string;
  displayName: string;
  preferences: number;
  patterns: number;
  workflows: number;
  totalPromptsAnalyzed: number;
  lastAnalyzedAt: number;
  inUse: boolean;
}

export class ProfileAdminError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function count(data: UserProfileData, field: keyof UserProfileData): number {
  const value = data?.[field];
  return Array.isArray(value) ? value.length : 0;
}

function parse(profile: UserProfile): UserProfileData {
  return JSON.parse(profile.profileData) as UserProfileData;
}

/** Every active profile with its item counts; `currentUserId` marks the one in use. */
export async function listProfiles(
  store: ProfileAdminStore,
  currentUserId: string | null
): Promise<ProfileSummary[]> {
  const profiles = await store.getAllActiveProfiles();
  return profiles
    .map((profile) => {
      const data = parse(profile);
      return {
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        preferences: count(data, "preferences"),
        patterns: count(data, "patterns"),
        workflows: count(data, "workflows"),
        totalPromptsAnalyzed: profile.totalPromptsAnalyzed,
        lastAnalyzedAt: profile.lastAnalyzedAt,
        inUse: profile.userId === currentUserId,
      };
    })
    .sort((a, b) => b.lastAnalyzedAt - a.lastAnalyzedAt);
}

/** Merge `sourceId` into `targetId` with profile learning's rules, then turn the source off. */
export async function mergeProfiles(
  store: ProfileAdminStore,
  sourceId: string,
  targetId: string
): Promise<{ target: ProfileSummary }> {
  if (!sourceId || !targetId)
    throw new ProfileAdminError("sourceId and targetId are required", 400);
  if (sourceId === targetId) throw new ProfileAdminError("A profile cannot merge into itself", 400);
  const source = await store.getProfileById(sourceId);
  const target = await store.getProfileById(targetId);
  if (!source?.isActive || !target?.isActive) {
    throw new ProfileAdminError("Both profiles must exist and be active", 404);
  }
  const merged = await store.mergeProfileData(parse(target), parse(source), undefined, target.id);
  const saved = await store.updateProfile(
    target.id,
    merged,
    source.totalPromptsAnalyzed,
    `Merged profile ${source.userId}`
  );
  if (!saved) throw new ProfileAdminError("Profile was changed by another session. Retry.", 409);
  await store.deactivateProfile(source.id);
  const after = (await store.getProfileById(target.id)) ?? target;
  const [summary] = await listProfiles(
    { ...store, getAllActiveProfiles: async () => [after] },
    null
  );
  return { target: summary! };
}
