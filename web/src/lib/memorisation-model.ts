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

/** The row title: the Topic of a snapshot, else the first line of the stored text. */
export function memorisationTitle(content: string): string {
  const lines = content.split("\n").map((line) => line.trim());
  const topic = lines.find((line) => /^topic:/i.test(line))?.replace(/^topic:\s*/i, "");
  return topic || lines.find(Boolean) || content;
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
