import type { MapDecision, PathMap } from "$lib/external-api-settings";

/** The entry the server uses for sessions that recorded no directory. */
export const NO_DIRECTORY = "";

export type SuggestedDirectory = { directory: string; sessions: number; suggestion: string | null };
export type ReviewedMap = { from: string; to: string; sessions: number };
export type DirectoryMapReview = { maps: ReviewedMap[]; unmapped: SuggestedDirectory[] };

/** Build a host's review without changing drafts; an explicitly cleared target stays empty. */
export function reviewDirectoryMaps(
  rows: readonly SuggestedDirectory[],
  decisions: Readonly<Record<string, MapDecision>>
): DirectoryMapReview {
  const maps = new Map<string, ReviewedMap>();
  const unmapped: SuggestedDirectory[] = [];
  for (const row of rows) {
    const target = (decisions[row.directory]?.target ?? row.suggestion ?? "").trim();
    if (row.directory === NO_DIRECTORY || !target) {
      unmapped.push({ ...row });
      continue;
    }
    const previous = maps.get(row.directory);
    maps.set(row.directory, {
      from: row.directory,
      to: target,
      sessions: (previous?.sessions ?? 0) + row.sessions,
    });
  }
  return { maps: [...maps.values()], unmapped };
}

/**
 * Smart resolve: accept the suggested target of every mappable row that has
 * one, without saving. Rows the user already decided keep their decision.
 */
export function applySuggestions(
  rows: readonly SuggestedDirectory[],
  decisions: Readonly<Record<string, MapDecision>>
): {
  decisions: Record<string, MapDecision>;
  filled: number;
  alreadySelected: number;
  notFilled: number;
} {
  const next = { ...decisions };
  let filled = 0;
  let notFilled = 0;
  let alreadySelected = 0;
  for (const row of rows) {
    if (row.directory === NO_DIRECTORY) continue;
    const accepted = next[row.directory]?.accepted;
    if (accepted) alreadySelected++;
    if (!row.suggestion) {
      notFilled++;
      continue;
    }
    if (accepted) continue;
    next[row.directory] = { directory: row.directory, target: row.suggestion, accepted: true };
    filled++;
  }
  return { decisions: next, filled, alreadySelected, notFilled };
}

/**
 * Build a confirmation payload from saved maps and the displayed review only.
 * Page selections and pending removals belong to manual Save maps, never this boundary.
 */
export function confirmedMapsToSave(
  saved: readonly PathMap[],
  reviewed: readonly ReviewedMap[]
): PathMap[] {
  const byFrom = new Map(saved.map((map) => [map.from, { ...map }]));
  for (const map of reviewed) byFrom.set(map.from, { from: map.from, to: map.to });
  return [...byFrom.values()];
}

/** Select rows with a target, retaining user edits and global source keys. */
export function selectWithTargets(
  rows: readonly SuggestedDirectory[],
  decisions: Readonly<Record<string, MapDecision>>
): Record<string, MapDecision> {
  const next = { ...decisions };
  for (const row of rows) {
    if (row.directory === NO_DIRECTORY) continue;
    const current = next[row.directory];
    const target = current?.target ?? row.suggestion ?? "";
    if (!target.trim()) continue;
    next[row.directory] = { directory: row.directory, target, accepted: true };
  }
  return next;
}

/** Deselect this host's source paths without discarding their target text. */
export function clearSelection(
  rows: readonly SuggestedDirectory[],
  decisions: Readonly<Record<string, MapDecision>>
): Record<string, MapDecision> {
  const next = { ...decisions };
  for (const row of rows) {
    if (row.directory === NO_DIRECTORY || !next[row.directory]) continue;
    next[row.directory] = { ...next[row.directory], accepted: false };
  }
  return next;
}
