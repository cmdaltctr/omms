/**
 * The six profile learning settings (change unify-profile-learning, design D6).
 * All are global only: a project config cannot set them. Pure on purpose, with no
 * `CONFIG` import, because many tests stub `src/config.js`. Callers pass the file
 * config. The first value of each option list is the default.
 */

export const PROFILE_LEARNING_OPTIONS = {
  userProfileWithoutEmail: ["learn", "skip"],
  userProfileDecayBeforeMerge: [false, true],
  userProfilePromptDetail: ["full", "prompts-only"],
  userProfileValidationEnabled: [false, true],
  showUserProfileToasts: [true, false],
  userProfileDuringCatchUp: ["learn", "pause"],
} as const;

export interface ProfileLearningSettings {
  /** No user email: `learn` into the profile `unknown`, or `skip` and leave the prompts waiting. */
  userProfileWithoutEmail: "learn" | "skip";
  /** Fade old profile items before each merge. */
  userProfileDecayBeforeMerge: boolean;
  /** `full` sends prompts, profile summary, guidelines and examples; `prompts-only` sends prompts. */
  userProfilePromptDetail: "full" | "prompts-only";
  /** Check older profile items against recent prompts. */
  userProfileValidationEnabled: boolean;
  /** Show a notice when a learning pass ends. */
  showUserProfileToasts: boolean;
  /** `learn` keeps live passes running during a catch-up run; `pause` stops them. */
  userProfileDuringCatchUp: "learn" | "pause";
}

type ProfileLearningKey = keyof ProfileLearningSettings;

export const PROFILE_LEARNING_KEYS = Object.keys(PROFILE_LEARNING_OPTIONS) as ProfileLearningKey[];

export const PROFILE_LEARNING_DEFAULTS = Object.fromEntries(
  PROFILE_LEARNING_KEYS.map((key) => [key, PROFILE_LEARNING_OPTIONS[key][0]])
) as unknown as ProfileLearningSettings;

/** The accepted values of each key as text, for error messages ("full, prompts-only"). */
export const PROFILE_LEARNING_ACCEPTED: Readonly<Record<ProfileLearningKey, string>> =
  Object.fromEntries(
    PROFILE_LEARNING_KEYS.map((key) => [
      key,
      typeof PROFILE_LEARNING_OPTIONS[key][0] === "boolean"
        ? "true, false"
        : PROFILE_LEARNING_OPTIONS[key].join(", "),
    ])
  ) as Record<ProfileLearningKey, string>;

export function isProfileLearningKey(key: string): key is ProfileLearningKey {
  return Object.hasOwn(PROFILE_LEARNING_OPTIONS, key);
}

function isAccepted(key: ProfileLearningKey, value: unknown): boolean {
  return (PROFILE_LEARNING_OPTIONS[key] as readonly unknown[]).includes(value);
}

/** The settings from a file config, with defaults. A rejected value names its key and the accepted values. */
export function profileLearningSettingsFrom(
  config: Partial<Record<ProfileLearningKey, unknown>>
): ProfileLearningSettings {
  const settings: Record<string, unknown> = {};
  for (const key of PROFILE_LEARNING_KEYS) {
    const value = config[key];
    if (value !== undefined && !isAccepted(key, value)) {
      throw new Error(`Invalid ${key} config (accepted: ${PROFILE_LEARNING_ACCEPTED[key]})`);
    }
    settings[key] = value ?? PROFILE_LEARNING_DEFAULTS[key];
  }
  return settings as unknown as ProfileLearningSettings;
}

/** A project config cannot set these keys. Each removed key is logged once, by name. */
export function removeProfileLearningProjectOverrides(
  overrides: Record<string, unknown>,
  log: (message: string) => void
): void {
  for (const key of PROFILE_LEARNING_KEYS) {
    if (!Object.hasOwn(overrides, key)) continue;
    log(`Project config cannot set ${key}; the value was ignored`);
    delete overrides[key];
  }
}

/** A Settings page edit: one accepted value, or `null` to remove the key so the default applies. */
export function isValidProfileLearningEdit(key: ProfileLearningKey, value: unknown): boolean {
  return value === null || isAccepted(key, value);
}
