import {
  memorisationCapError,
  memorisationCapIsValid,
  type MemorisationSettings,
} from "./memorisation.js";

export type { MemorisationSettings } from "./memorisation.js";

export const MEMORISATION_KEYS = [
  "memorisationMaxSize",
  "memorisationSizeUnit",
  "memorisationRepeat",
] as const;
export const MEMORISATION_DEFAULTS: MemorisationSettings = {
  memorisationMaxSize: 2000,
  memorisationSizeUnit: "characters",
  memorisationRepeat: "add",
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
  return { memorisationMaxSize, memorisationSizeUnit, memorisationRepeat };
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

/** The three settings are global-only; a project config cannot replace them. */
export function removeMemorisationProjectOverrides(config: Record<string, unknown>): void {
  for (const key of MEMORISATION_KEYS) delete config[key];
}
