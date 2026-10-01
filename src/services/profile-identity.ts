/**
 * Which stored profile belongs to the person using OMMS. The web app can run
 * outside any project (the login item starts in `/`), so the folder's git
 * email alone is not enough.
 */
export interface ProfileIdentityDeps {
  cwdGitEmail(): string | null;
  globalGitEmail(): string | null;
  activeProfileUserIds(): Promise<string[]>;
}

export async function resolveProfileUserId(
  config: { userEmailOverride?: string },
  deps: ProfileIdentityDeps
): Promise<string | null> {
  const override = config.userEmailOverride?.trim();
  if (override) return override;
  const email = deps.cwdGitEmail() || deps.globalGitEmail();
  if (email) return email;
  const ids = await deps.activeProfileUserIds();
  return ids.length === 1 ? ids[0]! : null;
}

/** The resolver wired to git and the profile store, for the web handlers. */
export async function resolveWebProfileUserId(config: {
  userEmailOverride?: string;
}): Promise<string | null> {
  const { getGitEmail, getGlobalGitEmail } = await import("./tags.js");
  const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
  return resolveProfileUserId(config, {
    cwdGitEmail: () => getGitEmail(process.cwd()),
    globalGitEmail: getGlobalGitEmail,
    activeProfileUserIds: async () =>
      (await userProfileManager.getAllActiveProfiles()).map((p) => p.userId),
  });
}
