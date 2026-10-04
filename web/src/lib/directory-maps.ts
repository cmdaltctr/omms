import type { MapDecision } from "$lib/external-api-settings";

/** The entry the server uses for sessions that recorded no directory. */
export const NO_DIRECTORY = "";

export type SuggestedDirectory = { directory: string; sessions: number; suggestion: string | null };

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
