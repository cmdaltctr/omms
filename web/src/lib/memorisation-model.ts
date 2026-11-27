import type { SortOption } from "$lib/components/paged-list";

/** One memorisation as the page shows it. `confidence` is set on a recall match only. */
export type Memorisation = {
  id: string;
  content: string;
  createdAt?: string;
  host?: string;
  kind?: string;
  /** Set when the record sits in a linked, read-only space. */
  space?: string;
  confidence?: number;
  /** The user and agent labels. The fixed `memorisation` tag is already removed. */
  tags?: string[];
};

/** Why a bulk delete left a record alone. */
export type SkipReason = "not-found" | "linked" | "not-memorisation";
export type BulkDeleteResult = { deleted: string[]; skipped: { id: string; reason: SkipReason }[] };

export type SizeUnit = "characters" | "tokens";
export type Repeat = "add" | "replace";

/** The allowed cap per unit. Mirrors `memorisationSizeRange` in `src/core/memorisation.ts`; a test pins both. */
export const SIZE_RANGE: Record<SizeUnit, { min: number; max: number }> = {
  characters: { min: 100, max: 20000 },
  tokens: { min: 25, max: 5000 },
};

export const isSizeUnit = (value: unknown): value is SizeUnit =>
  value === "characters" || value === "tokens";
export const isRepeat = (value: unknown): value is Repeat => value === "add" || value === "replace";

/** The number the box holds, or null when it is empty, not whole, or outside the range of `unit`. */
export function parseCap(text: string, unit: SizeUnit): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  const { min, max } = SIZE_RANGE[unit];
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** Plain text of one line of Markdown: no heading, list, emphasis, code or link marks. */
function plainLine(line: string): string {
  return (
    line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^([-*+]|\d+[.)])\s+/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/\*{1,3}([^*]+?)\*{1,3}/g, "$1")
      // Underscores count as emphasis only at the edge of a word, so snake_case stays.
      .replace(/(^|[\s(])_{1,2}([^_]+?)_{1,2}(?=[\s).,;:!?]|$)/g, "$1$2")
      .trim()
  );
}

/** The row title as plain text: the Topic of an older snapshot, else the first line, with Markdown marks removed. */
export function memorisationTitle(content: string): string {
  const lines = content.split("\n").map((line) => line.trim());
  const topic = lines.find((line) => /^topic:/i.test(line))?.replace(/^topic:\s*/i, "");
  return plainLine(topic || lines.find(Boolean) || content) || content.trim();
}

export type Preset = "short" | "medium" | "long";
export const PRESETS: readonly Preset[] = ["short", "medium", "long"];
/** Characters per preset. These are the defaults of `memorisationShortSize` and its two siblings. */
export const DEFAULT_PRESETS: Record<Preset, number> = { short: 800, medium: 2000, long: 5000 };
/** The setting that holds each preset, in characters. */
export const PRESET_KEYS: Record<Preset, string> = {
  short: "memorisationShortSize",
  medium: "memorisationMediumSize",
  long: "memorisationLongSize",
};

/** A preset in `unit`. Same rule as `presetSizeIn` in `src/core/memorisation.ts`; a test pins both. */
export const presetSizeIn = (chars: number, unit: SizeUnit): number =>
  unit === "tokens" ? Math.ceil(chars / 4) : chars;

/** The presets from the settings snapshot; a missing or odd value falls back to its default. */
export function presetsFrom(read: (key: string) => unknown): Record<Preset, number> {
  const pick = (preset: Preset) => {
    const value = read(PRESET_KEYS[preset]);
    return typeof value === "number" ? value : DEFAULT_PRESETS[preset];
  };
  return { short: pick("short"), medium: pick("medium"), long: pick("long") };
}

/** The preset whose value in `unit` equals the number in the box, else "custom". */
export function selectedPreset(
  size: string | number | undefined,
  unit: SizeUnit,
  presets: Record<Preset, number>
): Preset | "custom" {
  const text = String(size ?? "").trim();
  if (!/^\d+$/.test(text)) return "custom";
  return PRESETS.find((preset) => presetSizeIn(presets[preset], unit) === Number(text)) ?? "custom";
}

export type PresetProblem =
  | { rule: "range"; preset: Preset }
  | { rule: "order"; lower: Preset; higher: Preset }
  | { rule: "token"; lower: Preset; higher: Preset; tokens: number };

/**
 * The edited presets as numbers, or the first rule they break: whole numbers in range, then
 * Short < Medium < Long, each at least one token above the one below (the core rule).
 */
export function checkPresets(
  drafts: Record<Preset, string>
): { presets: Record<Preset, number> } | { problem: PresetProblem } {
  const { min, max } = SIZE_RANGE.characters;
  const presets = {} as Record<Preset, number>;
  for (const preset of PRESETS) {
    const text = drafts[preset].trim();
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      return { problem: { rule: "range", preset } };
    }
    presets[preset] = value;
  }
  for (let i = 1; i < PRESETS.length; i++) {
    const lower = PRESETS[i - 1]!;
    const higher = PRESETS[i]!;
    if (presets[lower] >= presets[higher]) return { problem: { rule: "order", lower, higher } };
    const tokens = presetSizeIn(presets[lower], "tokens");
    if (tokens >= presetSizeIn(presets[higher], "tokens")) {
      return { problem: { rule: "token", lower, higher, tokens } };
    }
  }
  return { presets };
}

/** Fills in the host of recall matches from the list, which knows it. */
export function withHosts(matches: Memorisation[], known: readonly Memorisation[]): Memorisation[] {
  const hosts = new Map(known.map((item) => [item.id, item]));
  return matches.map((match) => ({
    ...match,
    host: match.host ?? hosts.get(match.id)?.host,
    kind: match.kind ?? hosts.get(match.id)?.kind,
  }));
}

const byTime = (a: Memorisation, b: Memorisation) =>
  (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

export type MemorisationSort = "newest" | "oldest";
/** Newest first by default. Labels are English messages that the toolbar translates. */
export const MEMORISATION_SORTS: readonly SortOption<MemorisationSort, Memorisation>[] = [
  { value: "newest", label: "Newest", first: "desc", flip: "oldest", compare: byTime },
  { value: "oldest", label: "Oldest", first: "asc", flip: "newest", compare: byTime },
];
