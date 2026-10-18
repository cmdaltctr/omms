/**
 * Choose profile items for the injected block by relevance to the prompt
 * (openspec change hook-search-keywords-and-profile). Pure functions: the
 * vector, the items, the counts, and the minimum closeness are arguments, so
 * callers and tests need no store and no CONFIG.
 */

export interface VectorItem {
  category?: string;
  anchor?: number[];
  centroid?: number[];
}

export interface SelectProfileItemsInput<T extends VectorItem> {
  /** Today's selection for the section, in today's order. */
  baseline: T[];
  /** Every eligible item, in today's order. Relevance may pick from all of them. */
  candidates: T[];
  /** Injected items for the section. */
  count: number;
  /** The embedded prompt. Without it the section keeps today's selection. */
  queryVector: ArrayLike<number> | undefined;
  /** Items with a lower cosine similarity never take a relevance slot. */
  minCloseness: number;
  /** Sections that group by category keep one item per category. */
  onePerCategory: boolean;
}

export interface SelectProfileItemsResult<T> {
  items: T[];
  /** How many items came in through relevance, for the log. */
  relevanceSlots: number;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Half of the slots, rounded up, go to the items closest to the prompt. The
 * other slots keep today's order. With no prompt vector, or no item close
 * enough, the result is `baseline` unchanged.
 */
export function selectProfileItems<T extends VectorItem>(
  input: SelectProfileItemsInput<T>
): SelectProfileItemsResult<T> {
  const { baseline, candidates, count, queryVector, minCloseness, onePerCategory } = input;
  const unchanged = { items: baseline, relevanceSlots: 0 };
  if (!queryVector || queryVector.length === 0 || count <= 0) return unchanged;

  const ranked = candidates
    .map((item) => {
      const vector = item.anchor ?? item.centroid;
      return { item, closeness: vector ? cosineSimilarity(queryVector, vector) : 0 };
    })
    .filter((entry) => entry.closeness >= minCloseness && entry.closeness > 0)
    .sort((a, b) => b.closeness - a.closeness);

  const chosen: T[] = [];
  const categories = new Set<string | undefined>();
  const take = (item: T): boolean => {
    if (chosen.includes(item)) return false;
    if (onePerCategory && categories.has(item.category)) return false;
    chosen.push(item);
    categories.add(item.category);
    return true;
  };

  const relevanceCap = Math.ceil(count / 2);
  let relevanceSlots = 0;
  for (const { item } of ranked) {
    if (relevanceSlots >= relevanceCap) break;
    if (take(item)) relevanceSlots++;
  }
  if (relevanceSlots === 0) return unchanged;

  for (const item of baseline) {
    if (chosen.length >= count) break;
    take(item);
  }
  // A skipped duplicate can leave a slot empty; fill it from the rest of the
  // eligible items so the section keeps its count.
  for (const item of candidates) {
    if (chosen.length >= count) break;
    take(item);
  }
  return { items: chosen, relevanceSlots };
}
