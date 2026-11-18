/**
 * The Profile learning table's pure definitions, with no React, config, or host imports, so tests
 * and the section share one source (mirrors keyword-mode-controls.ts). The six keys, their
 * options and their defaults follow design D6 of the unify-profile-learning change: the first
 * option of each list is the default.
 */

export const PROFILE_LEARNING_KEYS = [
  "userProfileWithoutEmail",
  "userProfileDecayBeforeMerge",
  "userProfilePromptDetail",
  "userProfileValidationEnabled",
  "showUserProfileToasts",
  "userProfileDuringCatchUp",
] as const;

export type ProfileLearningKey = (typeof PROFILE_LEARNING_KEYS)[number];
/** What the config file holds: text for three keys, true or false for the other three. */
export type LearningValue = string | boolean;
export type LearningDraft = Record<ProfileLearningKey, LearningValue>;
type LearningOption = { value: LearningValue; label: string };
type LearningControl = {
  key: ProfileLearningKey;
  controlId: string;
  options: readonly LearningOption[];
};

/** The labels are plain words; the values stay what the file holds. The first option is the default. */
export const PROFILE_LEARNING_CONTROLS: readonly LearningControl[] = [
  {
    key: "userProfileWithoutEmail",
    controlId: "profile-learning-without-email",
    options: [
      { value: "learn", label: "Learn anyway" },
      { value: "skip", label: "Skip" },
    ],
  },
  {
    key: "userProfileDecayBeforeMerge",
    controlId: "profile-learning-decay",
    options: [
      { value: false, label: "Off" },
      { value: true, label: "On" },
    ],
  },
  {
    key: "userProfilePromptDetail",
    controlId: "profile-learning-prompt-detail",
    options: [
      { value: "full", label: "Prompts with profile summary and guidance" },
      { value: "prompts-only", label: "Prompts only" },
    ],
  },
  {
    key: "userProfileValidationEnabled",
    controlId: "profile-learning-validation",
    options: [
      { value: false, label: "Off" },
      { value: true, label: "On" },
    ],
  },
  {
    key: "showUserProfileToasts",
    controlId: "profile-learning-notice",
    options: [
      { value: true, label: "On" },
      { value: false, label: "Off" },
    ],
  },
  {
    key: "userProfileDuringCatchUp",
    controlId: "profile-learning-during-catch-up",
    options: [
      { value: "learn", label: "Keep learning" },
      { value: "pause", label: "Pause" },
    ],
  },
];

/** Behaviours with no second option worth offering. They show as text and have no config key. */
export const PROFILE_LEARNING_FIXED_ROWS: readonly {
  name: string;
  description: string;
  value: string;
}[] = [
  {
    name: "History entry",
    description:
      "The text of each profile version that learning saves, with the host's display name.",
    value: "<Host> analysis of N prompts",
  },
  {
    name: "When the host model fails",
    description: "Learning tries the saved external API and shows a short notice.",
    value: "Use the external API and show a notice",
  },
  {
    name: "Reply check",
    description: "Every model reply is checked against the profile format before it is merged.",
    value: "On",
  },
  {
    name: "Save clash",
    description:
      "When the profile changes during a save, OMMS merges again without asking the model.",
    value: "3 tries, then wait 10 minutes",
  },
];

/** Every English message the section shows through the Settings table, besides the row texts above. */
export const PROFILE_LEARNING_MESSAGES: readonly string[] = [
  "Learning settings",
  "These settings apply to every host. They are saved in the global config file.",
  "Fixed. This is not a setting.",
  "Reset to default",
  "Reset the learning settings?",
  "This removes the six learning settings from the global config file. Every row goes back to its default.",
  "Saved. The next learning pass uses these settings.",
  "Reset. Every row shows its default.",
  "The learning settings could not be saved. Reload the page to try again.",
  "The learning settings could not be reset. Reload the page to try again.",
  "The learning settings could not be loaded. Reload the page to try again.",
  "Config changed. Reload settings and save again.",
  "Current settings were reloaded; check the values and save again.",
  "The current settings could not be reloaded. Reload the page.",
  "Save",
  "Cancel",
  "Saving…",
  "Default settings",
  "Custom settings",
];

const keyed = <T>(build: (key: ProfileLearningKey) => T) =>
  Object.fromEntries(PROFILE_LEARNING_KEYS.map((key) => [key, build(key)])) as Record<
    ProfileLearningKey,
    T
  >;

const controlFor = (key: ProfileLearningKey) =>
  PROFILE_LEARNING_CONTROLS.find((entry) => entry.key === key)!;

/** The default of every row: the first option of its list. */
export function learningDefaults(): LearningDraft {
  return keyed((key) => controlFor(key).options[0]!.value);
}

/** The saved values from a settings snapshot. A missing or unknown value shows the default. */
export function learningFromSettings(
  settings: Record<string, { globalValue?: unknown } | undefined> | undefined
): LearningDraft {
  const defaults = learningDefaults();
  return keyed((key) => {
    const value = settings?.[key]?.globalValue;
    return controlFor(key).options.some((option) => option.value === value)
      ? (value as LearningValue)
      : defaults[key];
  });
}

/** The body of the save request: only the keys that differ from the saved values. */
export function learningSaveEdits(
  draft: Partial<LearningDraft>,
  saved: LearningDraft
): Partial<LearningDraft> {
  const edits: Partial<LearningDraft> = {};
  for (const key of PROFILE_LEARNING_KEYS) {
    const value = draft[key];
    if (value !== undefined && value !== saved[key]) edits[key] = value;
  }
  return edits;
}

/** The body of the reset request: null removes a key from the file, so its default applies. */
export function learningResetEdits(): Record<ProfileLearningKey, null> {
  return keyed(() => null);
}

/** True when one of the six keys is in the global file. A global-only key has source "global" exactly then. */
export function hasSavedLearningKey(
  settings: Record<string, { source?: string; hasGlobal?: boolean } | undefined> | undefined
): boolean {
  return PROFILE_LEARNING_KEYS.some((key) => {
    const setting = settings?.[key];
    return setting?.hasGlobal === true || setting?.source === "global";
  });
}
