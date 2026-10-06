import type { MapDecision, PathMap } from "$lib/external-api-settings";

/** The entry the server uses for sessions that recorded no directory. */
export const NO_DIRECTORY = "";

export type MapConfidence = "exact" | "name" | "guess";
export type IgnoreReason = "temporary" | "node_modules" | "app-data" | "skills";
export type MapSuggestion =
  | { kind: "map"; target: string; confidence: MapConfidence }
  | { kind: "ignore"; reason: IgnoreReason };
export type SuggestedDirectory = {
  directory: string;
  sessions: number;
  suggestion: MapSuggestion | null;
};
export type ReviewedMap = { from: string; to: string; sessions: number; confidence: MapConfidence };
export type ReviewedIgnore = { directory: string; sessions: number; reason: IgnoreReason };
export type DirectoryMapReview = {
  maps: ReviewedMap[];
  ignores: ReviewedIgnore[];
  unmapped: SuggestedDirectory[];
};

/** The target a row shows: the user's edit, else a suggested map target. */
export function rowTarget(row: SuggestedDirectory, decision?: MapDecision): string {
  if (decision) return decision.target;
  return row.suggestion?.kind === "map" ? row.suggestion.target : "";
}

/**
 * Build a host's review without changing drafts. An edited target counts as
 * exact; an explicitly cleared target stays unmapped.
 */
export function reviewDirectoryMaps(
  rows: readonly SuggestedDirectory[],
  decisions: Readonly<Record<string, MapDecision>>
): DirectoryMapReview {
  const maps = new Map<string, ReviewedMap>();
  const ignores = new Map<string, ReviewedIgnore>();
  const unmapped: SuggestedDirectory[] = [];
  for (const row of rows) {
    const decision = decisions[row.directory];
    const target = rowTarget(row, decision).trim();
    if (row.directory !== NO_DIRECTORY && target) {
      const confidence =
        decision || row.suggestion?.kind !== "map" ? "exact" : row.suggestion.confidence;
      const previous = maps.get(row.directory);
      const sessions = (previous?.sessions ?? 0) + row.sessions;
      maps.set(row.directory, { from: row.directory, to: target, sessions, confidence });
    } else if (row.directory !== NO_DIRECTORY && !decision && row.suggestion?.kind === "ignore") {
      const previous = ignores.get(row.directory);
      const sessions = (previous?.sessions ?? 0) + row.sessions;
      ignores.set(row.directory, {
        directory: row.directory,
        sessions,
        reason: row.suggestion.reason,
      });
    } else {
      unmapped.push({ ...row });
    }
  }
  return { maps: [...maps.values()], ignores: [...ignores.values()], unmapped };
}

/** The items ticked when the dialog opens: exact and name maps and every ignore proposal. */
export function defaultTicks(review: DirectoryMapReview): Set<string> {
  return new Set([
    ...review.maps.filter((map) => map.confidence !== "guess").map((map) => map.from),
    ...review.ignores.map((item) => item.directory),
  ]);
}

/**
 * The settings edits for Confirm: saved maps and ignored directories plus the
 * ticked items of the review. A key with nothing ticked is left out.
 */
export function confirmedEdits(
  saved: readonly PathMap[],
  ignored: readonly string[],
  review: DirectoryMapReview,
  ticked: ReadonlySet<string>
): { importPathMaps?: PathMap[]; importIgnoredDirectories?: string[] } {
  const edits: { importPathMaps?: PathMap[]; importIgnoredDirectories?: string[] } = {};
  const maps = review.maps.filter((map) => ticked.has(map.from));
  if (maps.length) {
    const byFrom = new Map(saved.map((map) => [map.from, { ...map }]));
    for (const map of maps) byFrom.set(map.from, { from: map.from, to: map.to });
    edits.importPathMaps = [...byFrom.values()];
  }
  const ignores = review.ignores.filter((item) => ticked.has(item.directory));
  if (ignores.length) {
    edits.importIgnoredDirectories = [
      ...new Set([...ignored, ...ignores.map((item) => item.directory)]),
    ];
  }
  return edits;
}

/** Saved maps grouped by target: the largest group first, then by target path. */
export function groupSavedMaps(saved: readonly PathMap[]): { target: string; maps: PathMap[] }[] {
  const byTarget = new Map<string, PathMap[]>();
  for (const map of saved) byTarget.set(map.to, [...(byTarget.get(map.to) ?? []), map]);
  return [...byTarget]
    .map(([target, maps]) => ({
      target,
      maps: maps.sort((a, b) => a.from.localeCompare(b.from)),
    }))
    .sort((a, b) => b.maps.length - a.maps.length || a.target.localeCompare(b.target));
}
