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
): { decisions: Record<string, MapDecision>; filled: number; notFilled: number } {
  const next = { ...decisions };
  let filled = 0;
  let notFilled = 0;
  for (const row of rows) {
    if (row.directory === NO_DIRECTORY || next[row.directory]?.accepted) continue;
    if (row.suggestion) {
      next[row.directory] = { directory: row.directory, target: row.suggestion, accepted: true };
      filled++;
    } else {
      notFilled++;
    }
  }
  return { decisions: next, filled, notFilled };
}
