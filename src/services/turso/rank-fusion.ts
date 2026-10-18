/**
 * Reciprocal rank fusion of the meaning list and the word list (openspec change
 * hook-search-keywords-and-profile, design decision 9). Pure: the threshold and
 * the limits are passed in, so do not import CONFIG here.
 */

/** The published constant of reciprocal rank fusion. */
export const RRF_K = 60;
/** Same size as the word-hit limit of one shard search (max(limit × 4, 32), limit 10). */
export const RRF_WORD_LIMIT = 40;

export interface FusionRow {
  id: string;
  similarity: number;
  /** Match strength of a word hit; missing or 0 means the memory has no word match. */
  keywordScore?: number;
}

export interface FusionOptions {
  /** Lowest similarity for the meaning list. */
  threshold: number;
  limit: number;
  wordLimit?: number;
}

const byIdAfter =
  (compare: (a: FusionRow, b: FusionRow) => number) => (a: FusionRow, b: FusionRow) =>
    compare(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Merge two ranked lists by rank only. The meaning list holds the rows at or
 * above the threshold, ranked by similarity. The word list holds the rows with
 * a word match, ranked by match strength. A row that is only in the word list
 * can be returned although its similarity is below the threshold. Ties break by
 * id so repeated searches agree. Each row keeps its own similarity.
 */
export function rankFusion<T extends FusionRow>(rows: T[], options: FusionOptions): T[] {
  const meaning = rows
    .filter((row) => row.similarity >= options.threshold)
    .sort(byIdAfter((a, b) => b.similarity - a.similarity));
  const words = rows
    .filter((row) => (row.keywordScore ?? 0) > 0)
    .sort(byIdAfter((a, b) => (b.keywordScore ?? 0) - (a.keywordScore ?? 0)))
    .slice(0, options.wordLimit ?? RRF_WORD_LIMIT);

  const fused = new Map<string, { row: T; score: number }>();
  for (const list of [meaning, words]) {
    list.forEach((row, index) => {
      const entry = fused.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + index + 1);
      fused.set(row.id, entry);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0))
    .slice(0, Math.max(0, options.limit))
    .map((entry) => entry.row);
}

/**
 * Fuse the candidates of all shards and drop the internal word score, so the
 * results have the same shape as in `boost` mode.
 */
export function fuseShardResults<T extends FusionRow>(
  rows: T[],
  threshold: number,
  limit: number
): Omit<T, "keywordScore">[] {
  return rankFusion(rows, { threshold, limit }).map(({ keywordScore: _word, ...rest }) => rest);
}
