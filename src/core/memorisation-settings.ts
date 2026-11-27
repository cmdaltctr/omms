import {
  memorisationCapError,
  memorisationCapIsValid,
  memorisationPresetsError,
  memorisationPresetsProblem,
  type MemorisationSettings,
} from "./memorisation.js";

export type { MemorisationSettings } from "./memorisation.js";

export const MEMORISATION_KEYS = [
  "memorisationMaxSize",
  "memorisationSizeUnit",
  "memorisationRepeat",
  "memorisationRerank",
  "memorisationShortSize",
  "memorisationMediumSize",
  "memorisationLongSize",
] as const;
export const MEMORISATION_DEFAULTS: MemorisationSettings = {
  memorisationMaxSize: 2000,
  memorisationSizeUnit: "characters",
  memorisationRepeat: "add",
  memorisationRerank: false,
  memorisationShortSize: 800,
  memorisationMediumSize: 2000,
  memorisationLongSize: 5000,
};

/** Global-only memorisation settings, with defaults for an older config file. */
export function settingsFrom(config: Partial<MemorisationSettings>): MemorisationSettings {
  const memorisationMaxSize =
    config.memorisationMaxSize ?? MEMORISATION_DEFAULTS.memorisationMaxSize;
  const memorisationSizeUnit =
    config.memorisationSizeUnit ?? MEMORISATION_DEFAULTS.memorisationSizeUnit;
  if (!memorisationCapIsValid(memorisationMaxSize, memorisationSizeUnit)) {
    throw new Error("Invalid memorisation size settings");
  }
  const memorisationRepeat = config.memorisationRepeat ?? MEMORISATION_DEFAULTS.memorisationRepeat;
  if (memorisationRepeat !== "add" && memorisationRepeat !== "replace") {
    throw new Error("Invalid memorisationRepeat config");
  }
  if (config.memorisationRerank !== undefined && typeof config.memorisationRerank !== "boolean") {
    throw new Error("Invalid memorisationRerank config");
  }
  const memorisationRerank = config.memorisationRerank ?? MEMORISATION_DEFAULTS.memorisationRerank;
  const presets = {
    memorisationShortSize:
      config.memorisationShortSize ?? MEMORISATION_DEFAULTS.memorisationShortSize,
    memorisationMediumSize:
      config.memorisationMediumSize ?? MEMORISATION_DEFAULTS.memorisationMediumSize,
    memorisationLongSize: config.memorisationLongSize ?? MEMORISATION_DEFAULTS.memorisationLongSize,
  };
  // The "Invalid <key> config" form lets the config loader name the key and its rule.
  const problem = memorisationPresetsProblem(presets, (key) => config[key] !== undefined);
  if (problem) throw new Error(`Invalid ${problem.key} config (accepted: ${problem.accepted})`);
  return {
    memorisationMaxSize,
    memorisationSizeUnit,
    memorisationRepeat,
    memorisationRerank,
    ...presets,
  };
}

/** The web writer validates the pair, so a unit edit cannot strand an invalid number. */
export function checkMemorisationSettingsEdits(
  edits: Record<string, unknown>,
  current: MemorisationSettings
): void {
  if (edits.memorisationRepeat !== undefined) {
    const repeat = edits.memorisationRepeat;
    if (repeat !== "add" && repeat !== "replace") {
      throw new Error("memorisationRepeat must be add or replace");
    }
  }
  if (edits.memorisationRerank !== undefined && typeof edits.memorisationRerank !== "boolean") {
    throw new Error("memorisationRerank must be true or false");
  }
  const edited = (key: keyof MemorisationSettings) =>
    Object.hasOwn(edits, key) ? edits[key] : current[key];
  const presetsError = memorisationPresetsError({
    memorisationShortSize: edited("memorisationShortSize"),
    memorisationMediumSize: edited("memorisationMediumSize"),
    memorisationLongSize: edited("memorisationLongSize"),
  });
  if (presetsError) throw new Error(presetsError);
  const hasSize = Object.hasOwn(edits, "memorisationMaxSize");
  const hasUnit = Object.hasOwn(edits, "memorisationSizeUnit");
  if (!hasSize && !hasUnit) return;
  const size = hasSize ? edits.memorisationMaxSize : current.memorisationMaxSize;
  const unit = hasUnit ? edits.memorisationSizeUnit : current.memorisationSizeUnit;
  if (!memorisationCapIsValid(size, unit)) {
    throw new Error(memorisationCapError(unit === "tokens" ? "tokens" : "characters"));
  }
}

export { settingsFrom as memorisationSettingsFrom };

const PRESET_KEYS = [
  "memorisationShortSize",
  "memorisationMediumSize",
  "memorisationLongSize",
] as const;

/**
 * The saved settings as the base for an edit. The presets are read as stored, without their
 * rules, so an edit can repair a file whose presets break them. The merged edit is checked
 * by `checkMemorisationSettingsEdits`.
 */
export function storedMemorisationSettings(
  config: Partial<MemorisationSettings>
): MemorisationSettings {
  const rest: Partial<MemorisationSettings> = { ...config };
  for (const key of PRESET_KEYS) delete rest[key];
  const settings = settingsFrom(rest);
  for (const key of PRESET_KEYS) settings[key] = config[key] ?? MEMORISATION_DEFAULTS[key];
  return settings;
}

/** The seven settings are global-only; a project config cannot replace them. */
export function removeMemorisationProjectOverrides(config: Record<string, unknown>): void {
  for (const key of MEMORISATION_KEYS) delete config[key];
}
