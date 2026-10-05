/**
 * Shared validation rules for the five memory-limit settings
 * (openspec change memory-context-controls). Pure functions only: values
 * are passed in, so config.ts, the settings writer, and the settings
 * snapshot share one rule set without importing CONFIG. Do not import
 * CONFIG here: many tests stub src/config.js with a partial module.
 */

export interface MemoryLimitRule {
  /** Settings identifier used by files, requests, and the UI. Nested settings use one dot. */
  readonly setting: string;
  /** JSONC leaf path. A nested setting maps to its leaf, never a literal dotted key. */
  readonly path: readonly string[];
  readonly default: number;
  readonly unit: string;
  /** Accepted-values text for error messages and help text. */
  readonly accepted: string;
  isValid(value: unknown): boolean;
}

function isPositiveSafeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function integerInRange(min: number, max: number) {
  return (value: unknown): boolean =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function rule(
  setting: string,
  path: readonly string[],
  defaultValue: number,
  unit: string,
  accepted: string,
  isValid: (value: unknown) => boolean
): MemoryLimitRule {
  return { setting, path, default: defaultValue, unit, accepted, isValid };
}

export const MEMORY_LIMITS = {
  maxMemories: rule(
    "maxMemories",
    ["maxMemories"],
    10,
    "results",
    "positive safe integers",
    isPositiveSafeInteger
  ),
  "chatMessage.maxMemories": rule(
    "chatMessage.maxMemories",
    ["chatMessage", "maxMemories"],
    3,
    "memories",
    "positive safe integers",
    isPositiveSafeInteger
  ),
  autoCaptureMaxContextBytes: rule(
    "autoCaptureMaxContextBytes",
    ["autoCaptureMaxContextBytes"],
    131072,
    "UTF-8 bytes",
    "integers from 16384 to 16777216",
    integerInRange(16384, 16777216)
  ),
  userProfileMaxContextBytes: rule(
    "userProfileMaxContextBytes",
    ["userProfileMaxContextBytes"],
    32768,
    "UTF-8 bytes",
    "integers from 1024 to 16777216",
    integerInRange(1024, 16777216)
  ),
  retrievalMaxTokens: rule(
    "retrievalMaxTokens",
    ["retrievalMaxTokens"],
    2000,
    "approximate tokens",
    "integers from 256 to 65536",
    integerInRange(256, 65536)
  ),
} as const satisfies Record<string, MemoryLimitRule>;

/** The five settings identifiers, in Memory card order. */
export const MEMORY_LIMIT_SETTINGS: readonly string[] = Object.keys(MEMORY_LIMITS);

const RULES: Readonly<Record<string, MemoryLimitRule>> = MEMORY_LIMITS;

export function getMemoryLimitRule(setting: string): MemoryLimitRule | undefined {
  return RULES[setting];
}

/**
 * Return `value` when the rule accepts it, otherwise throw naming the setting
 * and its accepted values. The value itself is never interpolated: live
 * reload logs these errors, and they must stay metadata-only.
 */
export function checkedMemoryLimit(rule: MemoryLimitRule, value: unknown): number {
  if (!rule.isValid(value)) {
    throw new Error(`Invalid ${rule.setting} config (accepted: ${rule.accepted})`);
  }
  return value as number;
}
