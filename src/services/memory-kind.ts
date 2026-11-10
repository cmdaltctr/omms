/** The records an ordinary memory read includes. Memorisations need an explicit request. */
export type MemoryKind = "normal" | "memorisation";

/** Appends the record-kind predicate before the query's result limit. */
export function memoryKindPredicate(column = "type", kind: MemoryKind = "normal"): string {
  return kind === "memorisation" ? `${column} = 'memorisation'` : `${column} IS NOT 'memorisation'`;
}

/** Untagged normal memories eligible for AI tag backfill. */
export const UNTAGGED_NORMAL_PREDICATE = `(tags IS NULL OR tags = '') AND ${memoryKindPredicate()}`;
