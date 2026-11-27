import { estimateTokens } from "./context-budget.js";

export type MemorisationSizeUnit = "characters" | "tokens";
export type MemorisationRepeat = "add" | "replace";
export type NoteLength = "short" | "medium" | "long" | "custom";

export interface MemorisationSettings {
  memorisationMaxSize: number;
  memorisationSizeUnit: MemorisationSizeUnit;
  memorisationRepeat: MemorisationRepeat;
  memorisationRerank: boolean;
  /** The note length presets, in characters. Short < Medium < Long. */
  memorisationShortSize: number;
  memorisationMediumSize: number;
  memorisationLongSize: number;
}

export interface MemorisationSnapshot {
  topic?: string;
  done?: string;
  doing?: string;
  next?: string;
}

/** A Markdown note: the topic as the first line, then a `##` section per field that has text. */
export function snapshotText(snapshot: MemorisationSnapshot): string {
  const topic = snapshot.topic?.trim();
  const sections = (["done", "doing", "next"] as const)
    .filter((key) => snapshot[key]?.trim())
    .map((key) => `## ${key[0]!.toUpperCase()}${key.slice(1)}\n${snapshot[key]!.trim()}`);
  return (topic ? [topic, ...sections] : sections).join("\n\n");
}

export function memorisationId(
  exists: (id: string) => boolean | Promise<boolean>,
  random: () => number = Math.random
): Promise<string> {
  return (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Math.floor(random() * 36 ** 6)
        .toString(36)
        .padStart(6, "0");
      const id = `ms-${suffix}`;
      if (!(await exists(id))) return id;
    }
    throw new Error("Could not allocate a unique memorisation ID after five tries");
  })();
}

export function isMemorisationId(value: string): boolean {
  return /^ms-[a-z0-9]{6}$/.test(value.trim());
}

export function memorisationSize(text: string, unit: MemorisationSizeUnit): number {
  return unit === "tokens" ? estimateTokens(text) : text.length;
}

export function memorisationSizeError(
  text: string,
  settings: Pick<MemorisationSettings, "memorisationMaxSize" | "memorisationSizeUnit">
): string | null {
  const size = memorisationSize(text, settings.memorisationSizeUnit);
  if (size <= settings.memorisationMaxSize) return null;
  const unit = settings.memorisationSizeUnit;
  return `Memorisation size limit is ${settings.memorisationMaxSize} ${unit}; the text has ${unit === "tokens" ? "about " : ""}${size} ${unit}. Shorten it and try again.`;
}

export function memorisationSizeRange(unit: MemorisationSizeUnit): { min: number; max: number } {
  return unit === "tokens" ? { min: 25, max: 5000 } : { min: 100, max: 20000 };
}

export function memorisationCapIsValid(maxSize: unknown, unit: unknown): maxSize is number {
  return (
    (unit === "characters" || unit === "tokens") &&
    Number.isSafeInteger(maxSize) &&
    (maxSize as number) >= memorisationSizeRange(unit).min &&
    (maxSize as number) <= memorisationSizeRange(unit).max
  );
}

export function memorisationCapError(unit: MemorisationSizeUnit): string {
  const { min, max } = memorisationSizeRange(unit);
  return `memorisationMaxSize must be a whole number from ${min} to ${max} ${unit}`;
}

type PresetKey = "memorisationShortSize" | "memorisationMediumSize" | "memorisationLongSize";

/** The presets from smallest to largest, with the name each one has in messages. */
const PRESETS: ReadonlyArray<readonly [Exclude<NoteLength, "custom">, PresetKey, string]> = [
  ["short", "memorisationShortSize", "Short"],
  ["medium", "memorisationMediumSize", "Medium"],
  ["long", "memorisationLongSize", "Long"],
];

/** A preset value in the cap's unit. Tokens use the same quarter rule as `estimateTokens`, rounded up. */
export function presetSizeIn(chars: number, unit: MemorisationSizeUnit): number {
  return unit === "tokens" ? Math.ceil(chars / 4) : chars;
}

/** A broken preset rule: the key to blame, a message for the user, and the values the key accepts. */
export interface MemorisationPresetsProblem {
  key: PresetKey;
  message: string;
  accepted: string;
}

/**
 * The first broken preset rule, or null when the three values are valid and in order. Each
 * preset must also be at least one token above the one below it, so the Tokens unit can tell
 * them apart. For a broken pair, `isSet` picks the key to blame: the one the config sets, or
 * the lower one when it sets both.
 */
export function memorisationPresetsProblem(
  presets: Record<PresetKey, unknown>,
  isSet: (key: PresetKey) => boolean = () => true
): MemorisationPresetsProblem | null {
  const { min, max } = memorisationSizeRange("characters");
  const range = `whole numbers from ${min} to ${max} characters`;
  for (const [, key] of PRESETS) {
    const value = presets[key];
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
      return {
        key,
        message: `${key} must be a whole number from ${min} to ${max} characters`,
        accepted: range,
      };
    }
  }
  for (let i = 1; i < PRESETS.length; i++) {
    const [, lowKey, low] = PRESETS[i - 1]!;
    const [, highKey, high] = PRESETS[i]!;
    const blameLow = isSet(lowKey) || !isSet(highKey);
    const key = blameLow ? lowKey : highKey;
    const relation = (step: string) =>
      `${range}, ${step}${blameLow ? "less" : "more"} than ${blameLow ? highKey : lowKey}`;
    const lowValue = presets[lowKey] as number;
    const highValue = presets[highKey] as number;
    if (lowValue >= highValue) {
      return { key, message: `${low} must be less than ${high}`, accepted: relation("") };
    }
    const tokens = presetSizeIn(lowValue, "tokens");
    if (tokens >= presetSizeIn(highValue, "tokens")) {
      return {
        key,
        message: `${low} and ${high} must differ by at least one token: both are about ${tokens} tokens`,
        accepted: relation("at least one token "),
      };
    }
  }
  return null;
}

/** The first broken preset rule as a plain message, or null when the three values are valid and in order. */
export function memorisationPresetsError(presets: Record<PresetKey, unknown>): string | null {
  return memorisationPresetsProblem(presets)?.message ?? null;
}

/** The preset that the saved cap equals in the saved unit, else `custom`. */
export function noteLengthFor(settings: MemorisationSettings): {
  length: NoteLength;
  maxSize: number;
  unit: MemorisationSizeUnit;
} {
  const unit = settings.memorisationSizeUnit;
  const maxSize = settings.memorisationMaxSize;
  const preset = PRESETS.find(([, key]) => presetSizeIn(settings[key], unit) === maxSize);
  return { length: preset?.[0] ?? "custom", maxSize, unit };
}

export interface RecallCandidate {
  id: string;
  content: string;
  confidence: number;
  createdAt?: string;
  space?: string;
}

const DEFAULT_RECALL_MATCHES = 3;

/** One clear winner is enough. Otherwise return three, or the caller's limit when one is given. */
export function pickRecallMatches<T extends { confidence: number }>(
  candidates: T[],
  limit?: number
): T[] {
  const maximum = Math.max(0, limit ?? DEFAULT_RECALL_MATCHES);
  if (candidates.length === 0 || maximum === 0) return [];
  const [first, second] = candidates;
  if (first && first.confidence >= 80 && first.confidence - (second?.confidence ?? 0) >= 10) {
    return [first];
  }
  return candidates.slice(0, maximum);
}

/** The fixed tag every memorisation carries. It is not a label the user sees. */
export const MEMORISATION_TAG = "memorisation";

const normaliseTag = (tag: string): string => tag.trim().toLowerCase();

/** A comma-separated tag list as unique, trimmed, lower-case tags in the order given. */
export function parseTagList(text: string | undefined): string[] {
  return [...new Set((text ?? "").split(",").map(normaliseTag).filter(Boolean))];
}

/** The labels of a record: its tags without the fixed memorisation tag, in stored order. */
export function visibleTags(tags: string[] | undefined): string[] {
  return (tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && normaliseTag(tag) !== MEMORISATION_TAG);
}

/**
 * The labels in use with the number of records that carry each. Labels that differ only in
 * letter case or surrounding spaces count as one, shown in the spelling seen first. A record
 * counts once per label. The fixed memorisation tag is left out. Most records come first, then name.
 */
export function countLabels(
  recordTags: ReadonlyArray<string[] | undefined>
): { label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const tags of recordTags) {
    const seen = new Set<string>();
    for (const label of visibleTags(tags)) {
      const key = normaliseTag(label);
      if (seen.has(key)) continue;
      seen.add(key);
      const own = counts.get(key);
      if (own) own.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * A recall label filter as groups. A comma means AND and a bar means OR, so `server | reactjs, api`
 * is `[["server", "reactjs"], ["api"]]`: a record needs api and one of server or reactjs.
 */
export function parseTagGroups(text: string | undefined): string[][] {
  const groups = (text ?? "")
    .split(",")
    .map((part) => [...new Set(part.split("|").map(normaliseTag).filter(Boolean))])
    .filter((group) => group.length > 0);
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = [...group].sort().join("|");
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

/** True when each group has at least one label the record carries. Case and surrounding spaces do not matter. */
export function matchesTagGroups(recordTags: string[] | undefined, groups: string[][]): boolean {
  const have = new Set((recordTags ?? []).map(normaliseTag));
  return groups.every((group) => group.some((tag) => have.has(normaliseTag(tag))));
}

/**
 * The project name as one more label, after the fixed tag and the caller's labels. The root
 * folder name `/` is not a usable label, so a caller there gets no project label.
 */
export function withProjectLabel(labels: string[], projectName: string | undefined): string[] {
  const name = projectName?.trim().toLowerCase();
  if (!name || name === "/") return labels;
  return labels.includes(name) ? labels : [...labels, name];
}
