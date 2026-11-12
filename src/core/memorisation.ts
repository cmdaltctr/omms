import { estimateTokens } from "./context-budget.js";

export type MemorisationSizeUnit = "characters" | "tokens";
export type MemorisationRepeat = "add" | "replace";

export interface MemorisationSettings {
  memorisationMaxSize: number;
  memorisationSizeUnit: MemorisationSizeUnit;
  memorisationRepeat: MemorisationRepeat;
  memorisationRerank: boolean;
}

export interface MemorisationSnapshot {
  topic?: string;
  done?: string;
  doing?: string;
  next?: string;
}

export function snapshotText(snapshot: MemorisationSnapshot): string {
  return (["topic", "done", "doing", "next"] as const)
    .filter((key) => snapshot[key]?.trim())
    .map((key) => `${key[0]!.toUpperCase()}${key.slice(1)}: ${snapshot[key]!.trim()}`)
    .join("\n");
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

/** True when the record carries every wanted tag. Case and surrounding spaces do not matter. */
export function hasAllTags(recordTags: string[] | undefined, wanted: string[]): boolean {
  const have = new Set((recordTags ?? []).map(normaliseTag));
  return wanted.every((tag) => have.has(normaliseTag(tag)));
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
